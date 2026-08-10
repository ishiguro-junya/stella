use crate::model::{ErrorCode, LineSelection, SelectionSide, WorkspaceError, WorkspaceResult};

#[derive(Debug)]
struct HunkLine<'a> {
    raw: &'a str,
    prefix: char,
    old_before: u32,
    new_before: u32,
    line_number: Option<u32>,
}

pub(crate) fn build_line_patch(
    raw_patch: &str,
    selection: &LineSelection,
) -> WorkspaceResult<String> {
    if selection.start_line == 0 || selection.end_line < selection.start_line {
        return Err(invalid("Invalid line selection range"));
    }
    if raw_patch.matches("diff --git ").count() != 1 {
        return Err(invalid("Line selection requires a single-file diff"));
    }
    let lines: Vec<&str> = raw_patch.split_inclusive('\n').collect();
    let first_hunk = lines
        .iter()
        .position(|line| line.starts_with("@@ "))
        .ok_or_else(|| invalid("No applicable text hunk was found"))?;
    let header = lines[..first_hunk].concat();
    let mut matching_hunks = Vec::new();
    let mut cursor = first_hunk;
    while cursor < lines.len() {
        if !lines[cursor].starts_with("@@ ") {
            cursor += 1;
            continue;
        }
        let (old_start, new_start) = parse_hunk_header(lines[cursor])?;
        let mut old_line = old_start;
        let mut new_line = new_start;
        let mut parsed = Vec::new();
        cursor += 1;
        while cursor < lines.len()
            && !lines[cursor].starts_with("@@ ")
            && !lines[cursor].starts_with("diff --git ")
        {
            let raw = lines[cursor];
            let prefix = raw.chars().next().unwrap_or(' ');
            let line_number = match (selection.side, prefix) {
                (SelectionSide::Additions, '+') => Some(new_line),
                (SelectionSide::Deletions, '-') => Some(old_line),
                _ => None,
            };
            parsed.push(HunkLine {
                raw,
                prefix,
                old_before: old_line,
                new_before: new_line,
                line_number,
            });
            match prefix {
                ' ' => {
                    old_line += 1;
                    new_line += 1;
                }
                '-' => old_line += 1,
                '+' => new_line += 1,
                '\\' => {}
                _ => return Err(invalid("Unknown unified diff line")),
            }
            cursor += 1;
        }
        let selected: Vec<usize> = parsed
            .iter()
            .enumerate()
            .filter_map(|(index, line)| {
                line.line_number
                    .filter(|number| {
                        *number >= selection.start_line && *number <= selection.end_line
                    })
                    .map(|_| index)
            })
            .collect();
        if !selected.is_empty() {
            matching_hunks.push((parsed, selected));
        }
    }
    if matching_hunks.len() != 1 {
        return Err(invalid(
            "Selection must be a contiguous range within one file and one hunk",
        ));
    }
    let (hunk, selected) = matching_hunks.pop().expect("one matching hunk");
    let expected_count = (selection.end_line - selection.start_line + 1) as usize;
    if selected.len() != expected_count || selected.windows(2).any(|pair| pair[1] != pair[0] + 1) {
        return Err(invalid(
            "Selection must contain contiguous changed lines from the same side",
        ));
    }

    let first = &hunk[selected[0]];
    let mut selected_lines = selected
        .iter()
        .map(|index| hunk[*index].raw)
        .collect::<String>();
    if let Some(next) = hunk.get(selected[selected.len() - 1] + 1)
        && next.prefix == '\\'
    {
        selected_lines.push_str(next.raw);
    }
    let hunk_header = match selection.side {
        SelectionSide::Additions => format!(
            "@@ -{},0 +{},{} @@\n",
            first.old_before.saturating_sub(1),
            first.old_before.max(1),
            expected_count
        ),
        SelectionSide::Deletions => format!(
            "@@ -{},{} +{},0 @@\n",
            selection.start_line,
            expected_count,
            first.new_before.saturating_sub(1)
        ),
    };
    Ok(format!("{header}{hunk_header}{selected_lines}"))
}

fn parse_hunk_header(header: &str) -> WorkspaceResult<(u32, u32)> {
    let mut fields = header.split_whitespace();
    if fields.next() != Some("@@") {
        return Err(invalid("Invalid hunk header"));
    }
    let old = fields.next().ok_or_else(|| invalid("Missing old range"))?;
    let new = fields.next().ok_or_else(|| invalid("Missing new range"))?;
    Ok((parse_start(old, '-')?, parse_start(new, '+')?))
}

fn parse_start(value: &str, prefix: char) -> WorkspaceResult<u32> {
    value
        .strip_prefix(prefix)
        .and_then(|value| value.split(',').next())
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| invalid("Invalid hunk range"))
}

fn invalid(message: &str) -> WorkspaceError {
    WorkspaceError::new(ErrorCode::InvalidRequest, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATCH: &str = "diff --git a/f.txt b/f.txt\nindex 422c2b7..62f9457 100644\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,4 @@\n one\n-old\n+new-a\n+new-b\n three\n";

    #[test]
    fn addition_selection_builds_zero_context_patch() {
        let patch = build_line_patch(
            PATCH,
            &LineSelection {
                path: "f.txt".into(),
                diff_revision: "revision".into(),
                side: SelectionSide::Additions,
                start_line: 2,
                end_line: 2,
            },
        )
        .unwrap();
        assert!(patch.contains("@@ -2,0 +3,1 @@\n+new-a\n"));
        assert!(!patch.contains("+new-b"));
        assert!(!patch.contains("-old"));
    }

    #[test]
    fn deletion_selection_builds_zero_context_patch() {
        let patch = build_line_patch(
            PATCH,
            &LineSelection {
                path: "f.txt".into(),
                diff_revision: "revision".into(),
                side: SelectionSide::Deletions,
                start_line: 2,
                end_line: 2,
            },
        )
        .unwrap();
        assert!(patch.contains("@@ -2,1 +1,0 @@\n-old\n"));
    }

    #[test]
    fn untracked_addition_selection_creates_the_first_index_line() {
        let patch = build_line_patch(
            "diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+first\n+second\n",
            &LineSelection {
                path: "new.txt".into(),
                diff_revision: "revision".into(),
                side: SelectionSide::Additions,
                start_line: 2,
                end_line: 2,
            },
        )
        .unwrap();
        assert!(patch.contains("@@ -0,0 +1,1 @@\n+second\n"));
        assert!(!patch.contains("+first"));
    }
}
