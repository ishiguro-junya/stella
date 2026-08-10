use crate::model::{ConventionalCommitInput, ErrorCode, WorkspaceError, WorkspaceResult};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub(crate) fn build_message(input: &ConventionalCommitInput) -> WorkspaceResult<String> {
    validate_type(&input.commit_type)?;
    if let Some(scope) = &input.scope
        && (scope.is_empty()
            || scope
                .chars()
                .any(|ch| ch == ')' || ch == '(' || ch.is_control()))
    {
        return Err(invalid("Invalid scope"));
    }
    let description = input.description.trim();
    if description.is_empty() || description.contains(['\r', '\n']) {
        return Err(invalid("Description is required and must be a single line"));
    }

    let mut subject = input.commit_type.clone();
    if let Some(scope) = &input.scope {
        subject.push('(');
        subject.push_str(scope);
        subject.push(')');
    }
    if input.breaking {
        subject.push('!');
    }
    subject.push_str(": ");
    subject.push_str(description);

    let mut sections = vec![subject];
    if let Some(body) = input
        .body
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        sections.push(body.to_owned());
    }

    let mut footers = Vec::new();
    for footer in &input.footers {
        let token = footer.token.trim();
        let value = footer.value.trim();
        if !valid_footer_token(token) || value.is_empty() {
            return Err(invalid("Invalid footer"));
        }
        footers.push(format!("{token}: {value}"));
    }
    if input.breaking
        && !input
            .footers
            .iter()
            .any(|footer| footer.token == "BREAKING CHANGE")
    {
        footers.push(format!("BREAKING CHANGE: {description}"));
    }
    if !footers.is_empty() {
        sections.push(footers.join("\n"));
    }

    let message = sections.join("\n\n");
    validate_conventional_message(&message)?;
    Ok(format!("{message}\n"))
}

pub(crate) fn validate_conventional_message(message: &str) -> WorkspaceResult<()> {
    let subject = message.lines().next().unwrap_or_default();
    let (prefix, description) = subject
        .split_once(": ")
        .ok_or_else(|| invalid("Subject must use the 'type: description' format"))?;
    if description.trim().is_empty() {
        return Err(invalid("Description cannot be empty"));
    }

    let prefix = prefix.strip_suffix('!').unwrap_or(prefix);
    if let Some(open) = prefix.find('(') {
        if !prefix.ends_with(')') || open == 0 {
            return Err(invalid("Invalid scope parentheses"));
        }
        validate_type(&prefix[..open])?;
        let scope = &prefix[open + 1..prefix.len() - 1];
        if scope.is_empty() || scope.contains(['(', ')']) {
            return Err(invalid("Invalid scope"));
        }
    } else {
        validate_type(prefix)?;
    }
    Ok(())
}

fn validate_type(value: &str) -> WorkspaceResult<()> {
    if value.is_empty() || !value.chars().all(|ch| ch.is_ascii_lowercase()) {
        return Err(invalid("Type must contain lowercase ASCII letters only"));
    }
    Ok(())
}

fn valid_footer_token(value: &str) -> bool {
    value == "BREAKING CHANGE"
        || (!value.is_empty()
            && value
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-'))
}

fn invalid(message: &str) -> WorkspaceError {
    WorkspaceError::new(ErrorCode::InvalidRequest, message)
}

pub(crate) struct MessageFile {
    path: PathBuf,
}

impl MessageFile {
    pub(crate) fn create(directory: &Path, message: &str) -> WorkspaceResult<Self> {
        let path = directory.join(format!("stella-message-{}.txt", Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
        file.write_all(message.as_bytes())
            .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
        file.sync_all()
            .map_err(|error| WorkspaceError::new(ErrorCode::Io, error.to_string()))?;
        Ok(Self { path })
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for MessageFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Fixtures {
        valid: Vec<String>,
        invalid: Vec<String>,
    }

    #[test]
    fn shared_conventional_commit_fixtures_match_rust_validator() {
        let fixtures: Fixtures =
            serde_json::from_str(include_str!("../../fixtures/conventional-commits.json"))
                .expect("valid fixture JSON");
        for value in fixtures.valid {
            assert!(
                validate_conventional_message(&value).is_ok(),
                "expected valid: {value:?}"
            );
        }
        for value in fixtures.invalid {
            assert!(
                validate_conventional_message(&value).is_err(),
                "expected invalid: {value:?}"
            );
        }
    }

    #[test]
    fn structured_breaking_message_gets_footer() {
        let message = build_message(&ConventionalCommitInput {
            commit_type: "feat".into(),
            scope: Some("workspace".into()),
            breaking: true,
            description: "契約を変更する".into(),
            body: None,
            footers: Vec::new(),
        })
        .unwrap();
        assert!(message.starts_with("feat(workspace)!: 契約を変更する"));
        assert!(message.contains("BREAKING CHANGE: 契約を変更する"));
    }
}
