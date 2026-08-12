use crate::model::{ErrorCode, PatchSelection, SelectionSide, WorkspaceError, WorkspaceResult};

#[derive(Debug)]
struct HunkLine<'a> {
    raw: &'a str,
    prefix: char,
    old_before: u32,
    new_before: u32,
    line_number: Option<u32>,
}

pub(crate) fn build_selected_patch(
    raw_patch: &str,
    selection: &PatchSelection,
) -> WorkspaceResult<String> {
    ensure_selectable_patch(raw_patch)?;
    match selection {
        PatchSelection::Lines {
            side,
            start_line,
            end_line,
            ..
        } => build_line_patch(raw_patch, *side, *start_line, *end_line),
        PatchSelection::Hunk { hunk_index, .. } => build_hunk_patch(raw_patch, *hunk_index),
    }
}

fn build_line_patch(
    raw_patch: &str,
    side: SelectionSide,
    start_line: u32,
    end_line: u32,
) -> WorkspaceResult<String> {
    if start_line == 0 || end_line < start_line {
        return Err(invalid("Invalid line selection range"));
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
            let line_number = match (side, prefix) {
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
                    .filter(|number| *number >= start_line && *number <= end_line)
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
    let expected_count = (end_line - start_line + 1) as usize;
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
    let hunk_header = match side {
        SelectionSide::Additions => format!(
            "@@ -{},0 +{},{} @@\n",
            first.old_before.saturating_sub(1),
            first.old_before.max(1),
            expected_count
        ),
        SelectionSide::Deletions => format!(
            "@@ -{},{} +{},0 @@\n",
            start_line,
            expected_count,
            first.new_before.saturating_sub(1)
        ),
    };
    Ok(format!("{header}{hunk_header}{selected_lines}"))
}

fn build_hunk_patch(raw_patch: &str, hunk_index: u32) -> WorkspaceResult<String> {
    let lines: Vec<&str> = raw_patch.split_inclusive('\n').collect();
    let first_hunk = lines
        .iter()
        .position(|line| line.starts_with("@@ "))
        .ok_or_else(|| invalid("No applicable text hunk was found"))?;
    let header = lines[..first_hunk].concat();
    let mut cursor = first_hunk;
    let mut current_index = 0_u32;

    while cursor < lines.len() {
        if !lines[cursor].starts_with("@@ ") {
            cursor += 1;
            continue;
        }
        let start = cursor;
        cursor += 1;
        while cursor < lines.len()
            && !lines[cursor].starts_with("@@ ")
            && !lines[cursor].starts_with("diff --git ")
        {
            cursor += 1;
        }
        if current_index == hunk_index {
            return Ok(format!("{header}{}", lines[start..cursor].concat()));
        }
        current_index += 1;
    }

    Err(invalid("Selected hunk was not found"))
}

fn ensure_selectable_patch(raw_patch: &str) -> WorkspaceResult<()> {
    if raw_patch.matches("diff --git ").count() != 1 {
        return Err(invalid("Partial selection requires a single-file diff"));
    }
    let header = raw_patch.split("\n@@ ").next().unwrap_or(raw_patch);
    let structural_change = header.lines().any(|line| {
        line.starts_with("old mode ")
            || line.starts_with("new mode ")
            || line.starts_with("rename from ")
            || line.starts_with("rename to ")
            || line.starts_with("copy from ")
            || line.starts_with("copy to ")
            || line.ends_with(" mode 120000")
            || line.starts_with("index ") && line.ends_with(" 160000")
    });
    if structural_change {
        return Err(invalid(
            "Partial selection is unavailable for structural file changes",
        ));
    }
    Ok(())
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
        let patch = build_selected_patch(
            PATCH,
            &PatchSelection::Lines {
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
        let patch = build_selected_patch(
            PATCH,
            &PatchSelection::Lines {
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
        let patch = build_selected_patch(
            "diff --git a/new.txt b/new.txt\nnew file mode 100644\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+first\n+second\n",
            &PatchSelection::Lines {
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

    #[test]
    fn hunk_selection_keeps_both_sides_of_only_the_requested_hunk() {
        let patch = build_selected_patch(
            "diff --git a/f.txt b/f.txt\nindex 1111111..2222222 100644\n--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n-old-one\n+new-one\n context\n@@ -10,2 +10,2 @@ section\n-old-two\n+new-two\n tail\n",
            &PatchSelection::Hunk {
                path: "f.txt".into(),
                diff_revision: "revision".into(),
                hunk_index: 1,
            },
        )
        .unwrap();

        assert!(patch.contains("@@ -10,2 +10,2 @@ section\n-old-two\n+new-two\n tail\n"));
        assert!(!patch.contains("old-one"));
        assert!(!patch.contains("new-one"));
    }

    #[test]
    fn hunk_selection_rejects_missing_and_structural_hunks() {
        let missing = build_selected_patch(
            PATCH,
            &PatchSelection::Hunk {
                path: "f.txt".into(),
                diff_revision: "revision".into(),
                hunk_index: 2,
            },
        )
        .unwrap_err();
        assert_eq!(missing.message, "Selected hunk was not found");

        let rename = build_selected_patch(
            "diff --git a/old.txt b/new.txt\nsimilarity index 50%\nrename from old.txt\nrename to new.txt\n--- a/old.txt\n+++ b/new.txt\n@@ -1 +1 @@\n-old\n+new\n",
            &PatchSelection::Hunk {
                path: "new.txt".into(),
                diff_revision: "revision".into(),
                hunk_index: 0,
            },
        )
        .unwrap_err();
        assert_eq!(
            rename.message,
            "Partial selection is unavailable for structural file changes"
        );
    }
}
