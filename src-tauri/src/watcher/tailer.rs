// Incremental byte-offset tailing of append-only JSONL transcripts.
//
// Transcripts grow to 100MB+, so we never re-read from the start: each file
// tracks a byte offset and we read only newly-appended bytes. On first sight we
// start a window from the end (recent activity is enough for state).
//
// Buffering is done in RAW BYTES, not a decoded String: a read can stop or start
// mid-UTF-8-codepoint (a write caught mid-flush, or the 128KB window landing
// inside a multi-byte char). We split on the `\n` byte and only `from_utf8_lossy`
// COMPLETE lines, so multi-byte chars (emoji, accented paths) are never corrupted
// across read boundaries.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// On first sight of a file, start this many bytes from the end.
const TAIL_WINDOW: u64 = 128 * 1024;

#[derive(Default)]
pub struct Tailer {
    offsets: HashMap<PathBuf, u64>,
    /// Trailing partial-line bytes carried to the next read (may end mid-codepoint).
    partials: HashMap<PathBuf, Vec<u8>>,
}

impl Tailer {
    pub fn new() -> Self {
        Self::default()
    }

    /// Complete lines appended since the last call. A partial final line (and any
    /// partial trailing codepoint) is buffered and completed on the next read.
    pub fn read_new_lines(&mut self, path: &Path) -> std::io::Result<Vec<String>> {
        let mut file = File::open(path)?;
        let len = file.metadata()?.len();

        let is_first = !self.offsets.contains_key(path);
        let mut offset = if is_first {
            len.saturating_sub(TAIL_WINDOW)
        } else {
            self.offsets[path]
        };
        if len < offset {
            offset = 0; // file truncated or rotated → restart, drop stale partial
            self.partials.remove(path);
        }
        // A windowed first read almost certainly starts mid-line; drop it.
        let skip_first_partial = is_first && offset > 0;

        file.seek(SeekFrom::Start(offset))?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        self.offsets.insert(path.to_path_buf(), len);

        let mut data = self.partials.remove(path).unwrap_or_default();
        data.extend_from_slice(&bytes);

        // Split on the newline BYTE; decode only complete segments.
        let mut lines: Vec<String> = Vec::new();
        let mut start = 0usize;
        for (i, b) in data.iter().enumerate() {
            if *b == b'\n' {
                let seg = &data[start..i];
                if !seg.is_empty() {
                    lines.push(String::from_utf8_lossy(seg).into_owned());
                }
                start = i + 1;
            }
        }
        // Remaining bytes after the last newline = partial line (carry forward).
        let trailing = data[start..].to_vec();
        self.partials.insert(path.to_path_buf(), trailing);

        if skip_first_partial && !lines.is_empty() {
            lines.remove(0);
        }
        Ok(lines)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn append(path: &Path, bytes: &[u8]) {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .unwrap();
        f.write_all(bytes).unwrap();
    }

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cm-tail-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("t.jsonl")
    }

    #[test]
    fn tails_appended_lines_incrementally() {
        let p = tmp("inc");
        let _ = std::fs::remove_file(&p);
        append(&p, b"{\"a\":1}\n{\"b\":2}\n");

        let mut t = Tailer::new();
        assert_eq!(t.read_new_lines(&p).unwrap().len(), 2);
        assert_eq!(t.read_new_lines(&p).unwrap().len(), 0);

        append(&p, b"{\"c\":3}\n{\"partial\":");
        assert_eq!(t.read_new_lines(&p).unwrap(), vec!["{\"c\":3}".to_string()]);

        append(&p, b"4}\n");
        assert_eq!(t.read_new_lines(&p).unwrap(), vec!["{\"partial\":4}".to_string()]);
    }

    #[test]
    fn resets_on_truncation() {
        let p = tmp("trunc");
        let _ = std::fs::remove_file(&p);
        append(&p, b"{\"x\":1}\n{\"xx\":11}\n");
        let mut t = Tailer::new();
        assert_eq!(t.read_new_lines(&p).unwrap().len(), 2);

        std::fs::write(&p, b"{\"y\":2}\n").unwrap();
        assert_eq!(t.read_new_lines(&p).unwrap(), vec!["{\"y\":2}".to_string()]);
    }

    #[test]
    fn preserves_multibyte_char_split_across_reads() {
        // "✨" = bytes E2 9C A8. Write a line whose emoji is split across two
        // appends, with a read in between (simulates a flush caught mid-codepoint).
        let p = tmp("utf8");
        let _ = std::fs::remove_file(&p);
        let mut t = Tailer::new();

        append(&p, b"{\"e\":\"\xE2\x9C"); // up to 2 of the 3 emoji bytes, no newline
        assert_eq!(t.read_new_lines(&p).unwrap().len(), 0, "no complete line yet");

        append(&p, b"\xA8\"}\n"); // final emoji byte + close + newline
        let lines = t.read_new_lines(&p).unwrap();
        assert_eq!(lines, vec!["{\"e\":\"✨\"}".to_string()]);
    }
}
