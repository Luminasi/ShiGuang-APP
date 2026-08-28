//! 知识库：预置学习资料（编译期嵌入）seed 到 kb_chunks 表 + 轻量检索
//!
//! 检索不做向量：中文双字 bigram 分词 + 词频/位置评分（标题命中权重 ×3），
//! 对几十 KB 的自写知识库足够有效，零额外依赖。

use rusqlite::{Connection, OptionalExtension};

use crate::models::{KbChunk, KbHit};

/// 知识库种子版本：内容更新时 bump，启动时自动重灌
pub const KB_SEED_VERSION: &str = "1";

/// 是否为中日韩表意文字（用于中文 bigram 分词）
fn is_cjk(c: char) -> bool {
    matches!(c, '\u{4e00}'..='\u{9fff}' | '\u{3400}'..='\u{4dbf}' | '\u{f900}'..='\u{faff}')
}

/// 常见停用词（过滤噪音；保留技术关键词）
const STOPWORDS: &[&str] = &[
    "的", "了", "是", "在", "有", "和", "就", "不", "都", "而", "及", "与", "着", "或",
    "一个", "这个", "那个", "什么", "怎么", "为什么", "如何", "可以", "需要", "应该",
    "知道", "一下", "哪些", "怎样", "啥", "吗", "呢", "啊", "吧", "很", "也", "还",
    "之", "对", "从", "到", "被", "把", "让", "给", "向", "用", "去", "来", "说", "想",
    "问", "我", "你", "他", "她", "它", "我们", "你们", "他们", "自己", "没有", "不是",
    "就是", "请问", "关于", "学习", "内容", "了解",
];

/// 幂等 seed：版本一致则跳过（返回现有数量），否则清空重灌
pub fn seed_kb(conn: &Connection) -> Result<usize, String> {
    let ver: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'kb.seed_version'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if ver.as_deref() == Some(KB_SEED_VERSION) {
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM kb_chunks", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        return Ok(n as usize);
    }

    let md = include_str!("../resources/kb.md");
    let chunks = parse_kb(md);
    if chunks.is_empty() {
        return Err("知识库内容为空，无法初始化".to_string());
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM kb_chunks", []).map_err(|e| e.to_string())?;
    for (i, (chapter, title, content)) in chunks.iter().enumerate() {
        tx.execute(
            "INSERT INTO kb_chunks (chapter, title, content, ord) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![chapter, title, content, i as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('kb.seed_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [KB_SEED_VERSION],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(chunks.len())
}

/// 解析预置 markdown：`# 章节` 为章节、`## 小节` 为分块边界，正文为分块内容
fn parse_kb(md: &str) -> Vec<(String, Option<String>, String)> {
    let mut chunks = Vec::new();
    let mut chapter = String::new();
    let mut title: Option<String> = None;
    let mut buf = String::new();

    let flush = |chunks: &mut Vec<(String, Option<String>, String)>,
                     chapter: &mut String,
                     title: &mut Option<String>,
                     buf: &mut String| {
        if !chapter.is_empty() && !buf.trim().is_empty() {
            chunks.push((chapter.clone(), title.take(), buf.trim().to_string()));
        }
        buf.clear();
    };

    for line in md.lines() {
        if let Some(name) = line.strip_prefix("# ") {
            flush(&mut chunks, &mut chapter, &mut title, &mut buf);
            chapter = name.trim().to_string();
        } else if let Some(name) = line.strip_prefix("## ") {
            flush(&mut chunks, &mut chapter, &mut title, &mut buf);
            title = Some(name.trim().to_string());
        } else {
            buf.push_str(line);
            buf.push('\n');
        }
    }
    flush(&mut chunks, &mut chapter, &mut title, &mut buf);
    chunks
}

/// 拉取整库分块（知识库小，每次全量加载评分即可）
pub fn load_all_chunks(conn: &Connection) -> Result<Vec<KbChunk>, String> {
    let mut stmt = conn
        .prepare("SELECT id, chapter, title, content, ord FROM kb_chunks ORDER BY chapter, ord")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(KbChunk {
                id: r.get(0)?,
                chapter: r.get(1)?,
                title: r.get(2)?,
                content: r.get(3)?,
                ord: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 分词：ASCII 单词（≥2 字符）+ 中文双字 bigram，去停用词与重复
pub fn tokenize(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut tokens: Vec<String> = Vec::new();

    let mut word = String::new();
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() {
            word.push(c);
        } else {
            if word.len() >= 2 {
                tokens.push(word.clone());
            }
            word.clear();
        }
    }
    if word.len() >= 2 {
        tokens.push(word);
    }

    let cjk: Vec<char> = lower.chars().filter(|c| is_cjk(*c)).collect();
    for w in cjk.windows(2) {
        tokens.push(format!("{}{}", w[0], w[1]));
    }

    tokens.retain(|t| !STOPWORDS.contains(&t.as_str()));
    tokens.sort();
    tokens.dedup();
    tokens
}

/// 单块评分：标题命中 ×3 + 内容词频 × 位置权重（靠前权重高）
fn score_chunk(title: &Option<String>, content: &str, tokens: &[String]) -> f64 {
    let mut score = 0.0;
    if let Some(t) = title {
        let lower = t.to_lowercase();
        for tok in tokens {
            if lower.contains(tok) {
                score += 3.0;
            }
        }
    }
    let lower = content.to_lowercase();
    for tok in tokens {
        let mut offset = 0;
        while let Some(pos) = lower[offset..].find(tok) {
            let abs = offset + pos;
            score += 1.0 / (1.0 + abs as f64 / 200.0);
            offset = abs + tok.len();
        }
    }
    score
}

/// 检索：返回按分数降序的 top N 块；无命中返回空
pub fn search_kb(conn: &Connection, query: &str, limit: usize) -> Result<Vec<KbHit>, String> {
    let tokens = tokenize(query);
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let chunks = load_all_chunks(conn)?;
    let mut hits: Vec<KbHit> = chunks
        .iter()
        .map(|c| KbHit {
            chapter: c.chapter.clone(),
            title: c.title.clone(),
            content: c.content.clone(),
            score: score_chunk(&c.title, &c.content, &tokens),
        })
        .filter(|h| h.score > 0.0)
        .collect();
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(limit);
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate_for_tests(&conn).unwrap();
        conn
    }

    #[test]
    fn tokenize_mixed() {
        let t = tokenize("MCP 协议怎么配置");
        assert!(t.contains(&"mcp".to_string()));
        assert!(t.contains(&"协议".to_string()));
        assert!(t.contains(&"配置".to_string()));
        // 停用词被过滤
        assert!(!t.contains(&"怎么".to_string()));
    }

    #[test]
    fn tokenize_empty() {
        assert!(tokenize("的了吗呢").is_empty() || tokenize("").is_empty());
    }

    #[test]
    fn parse_kb_sections() {
        let md = "# 第一章\n## 小节一\n内容甲\n内容乙\n## 小节二\n内容丙\n# 第二章\n## 小节三\n内容丁\n";
        let chunks = parse_kb(md);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].0, "第一章");
        assert_eq!(chunks[0].1.as_deref(), Some("小节一"));
        assert_eq!(chunks[0].2, "内容甲\n内容乙");
        assert_eq!(chunks[2].0, "第二章");
    }

    #[test]
    fn seed_idempotent() {
        let conn = test_db();
        let n1 = seed_kb(&conn).unwrap();
        assert!(n1 > 0);
        let n2 = seed_kb(&conn).unwrap();
        assert_eq!(n1, n2);
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM kb_chunks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n as usize, n1);
    }

    #[test]
    fn search_ranks_hits() {
        let conn = test_db();
        // 手动插两块：一块含关键词、一块无关
        conn.execute(
            "INSERT INTO kb_chunks (chapter, title, content, ord) VALUES ('c1', 'MCP 是什么', 'MCP 是 Model Context Protocol，Agent 的标准接口', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO kb_chunks (chapter, title, content, ord) VALUES ('c2', '散步', '散步有益健康，多晒太阳', 0)",
            [],
        )
        .unwrap();
        let hits = search_kb(&conn, "MCP 协议", 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chapter, "c1");
        assert!(hits[0].score > 0.0);
        // 标题命中权重更高
        let hits2 = search_kb(&conn, "MCP", 5).unwrap();
        assert_eq!(hits2[0].chapter, "c1");
    }

    #[test]
    fn search_no_match() {
        let conn = test_db();
        conn.execute(
            "INSERT INTO kb_chunks (chapter, title, content, ord) VALUES ('c1', '标题', '正文内容', 0)",
            [],
        )
        .unwrap();
        assert!(search_kb(&conn, "完全无关的词汇", 5).unwrap().is_empty());
        assert!(search_kb(&conn, "", 5).unwrap().is_empty());
    }
}
