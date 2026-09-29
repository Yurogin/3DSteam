//! Parseur minimal du format texte KeyValues de Valve (`.vdf` / `.acf`).
//!
//! ```text
//! "AppState"
//! {
//!     "appid"   "239820"
//!     "name"    "Game Dev Tycoon"
//! }
//! ```

#[derive(Debug, Clone, PartialEq)]
pub enum Vdf {
    Str(String),
    Obj(Vec<(String, Vdf)>),
}

impl Vdf {
    /// Accès à une clé (insensible à la casse : Steam mélange `LastPlayed` / `lastplayed`).
    pub fn get(&self, key: &str) -> Option<&Vdf> {
        match self {
            Vdf::Obj(entries) => entries
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, v)| v),
            Vdf::Str(_) => None,
        }
    }

    pub fn get_str(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(Vdf::as_str)
    }

    pub fn get_u64(&self, key: &str) -> Option<u64> {
        self.get_str(key).and_then(|s| s.trim().parse().ok())
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Vdf::Str(s) => Some(s),
            Vdf::Obj(_) => None,
        }
    }

    pub fn entries(&self) -> &[(String, Vdf)] {
        match self {
            Vdf::Obj(entries) => entries,
            Vdf::Str(_) => &[],
        }
    }
}

#[derive(Debug, PartialEq)]
enum Token {
    Str(String),
    Open,
    Close,
}

fn tokenize(input: &str) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();

    while let Some(&c) = chars.peek() {
        match c {
            '\u{feff}' => {
                chars.next();
            }
            c if c.is_whitespace() => {
                chars.next();
            }
            '{' => {
                chars.next();
                tokens.push(Token::Open);
            }
            '}' => {
                chars.next();
                tokens.push(Token::Close);
            }
            '/' => {
                chars.next();
                if chars.peek() == Some(&'/') {
                    // Commentaire jusqu'à la fin de ligne.
                    for c in chars.by_ref() {
                        if c == '\n' {
                            break;
                        }
                    }
                } else {
                    return Err("caractère '/' inattendu".into());
                }
            }
            '"' => {
                chars.next();
                let mut s = String::new();
                loop {
                    match chars.next() {
                        Some('"') => break,
                        Some('\\') => match chars.next() {
                            Some('n') => s.push('\n'),
                            Some('t') => s.push('\t'),
                            Some(other) => s.push(other),
                            None => return Err("échappement non terminé".into()),
                        },
                        Some(other) => s.push(other),
                        None => return Err("chaîne non terminée".into()),
                    }
                }
                tokens.push(Token::Str(s));
            }
            _ => {
                // Jeton non guillemeté (rare, mais autorisé par le format).
                let mut s = String::new();
                while let Some(&c) = chars.peek() {
                    if c.is_whitespace() || c == '{' || c == '}' || c == '"' {
                        break;
                    }
                    s.push(c);
                    chars.next();
                }
                // Conditions de plateforme du type `[$WIN32]` : ignorées.
                if !(s.starts_with('[') && s.ends_with(']')) {
                    tokens.push(Token::Str(s));
                }
            }
        }
    }
    Ok(tokens)
}

fn parse_object<I: Iterator<Item = Token>>(
    tokens: &mut std::iter::Peekable<I>,
    top_level: bool,
) -> Result<Vdf, String> {
    let mut entries = Vec::new();
    loop {
        match tokens.next() {
            None if top_level => return Ok(Vdf::Obj(entries)),
            None => return Err("accolade fermante manquante".into()),
            Some(Token::Close) if !top_level => return Ok(Vdf::Obj(entries)),
            Some(Token::Close) => return Err("accolade fermante en trop".into()),
            Some(Token::Open) => return Err("accolade ouvrante sans clé".into()),
            Some(Token::Str(key)) => {
                let value = match tokens.next() {
                    Some(Token::Str(v)) => Vdf::Str(v),
                    Some(Token::Open) => parse_object(tokens, false)?,
                    Some(Token::Close) | None => {
                        return Err(format!("valeur manquante pour la clé \"{key}\""))
                    }
                };
                entries.push((key, value));
            }
        }
    }
}

/// Parse un document complet. La racine est un objet contenant la/les clé(s) de premier niveau.
pub fn parse(input: &str) -> Result<Vdf, String> {
    let mut tokens = tokenize(input)?.into_iter().peekable();
    parse_object(&mut tokens, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_appmanifest() {
        let doc = parse(
            r#""AppState"
            {
                "appid"		"239820"
                "name"		"Game \"Dev\" Tycoon"
                "LastPlayed"		"1776874471"
                "UserConfig" { "language" "french" } // commentaire
            }"#,
        )
        .unwrap();
        let app = doc.get("appstate").unwrap();
        assert_eq!(app.get_u64("appid"), Some(239820));
        assert_eq!(app.get_str("name"), Some("Game \"Dev\" Tycoon"));
        assert_eq!(app.get_u64("lastplayed"), Some(1776874471));
        assert_eq!(app.get("UserConfig").unwrap().get_str("language"), Some("french"));
    }

    #[test]
    fn parses_windows_paths() {
        let doc = parse(r#""libraryfolders" { "0" { "path" "C:\\Program Files (x86)\\Steam" } }"#).unwrap();
        let path = doc.get("libraryfolders").unwrap().get("0").unwrap().get_str("path");
        assert_eq!(path, Some(r"C:\Program Files (x86)\Steam"));
    }

    #[test]
    fn rejects_unbalanced() {
        assert!(parse(r#""a" { "b" "c""#).is_err());
    }
}
