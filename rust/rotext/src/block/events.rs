use crate::{common::Range, events::EventType};

#[derive(Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Event {
    /// 有待下个阶段决定。参见 [crate::global::Event::Undetermined]。
    Undetermined(Range) = EventType::Undetermined as u32,
    /// LF 换行。只在行内内容中产生。
    LineFeed = EventType::LineFeed as u32,

    // 退出一层 “进入…”。
    Exit = EventType::Exit as u32,

    /// 逐字文本转义。参见 [crate::global::Event::VerbatimEscaping]。
    VerbatimEscaping {
        content: Range,
    } = EventType::VerbatimEscaping as u32,

    /// 进入段落。
    EnterParagraph = EventType::EnterParagraph as u32,
    /// 分割线
    ThematicBreak = EventType::ThematicBreak as u32,
    /// 代码块。
    EnterCodeBlock = EventType::EnterCodeBlock as u32,
    EnterCodeBlockMeta = EventType::EnterCodeBlockMeta as u32,
    EnterCodeBlockContent = EventType::EnterCodeBlockContent as u32,
}

impl Event {
    #[cfg(test)]
    pub fn discriminant(&self) -> u32 {
        unsafe { *<*const _>::from(self).cast::<u32>() }
    }

    pub fn content(&self, input: &[u8]) -> Option<String> {
        let result = match self {
            Event::Undetermined(content) => content.content(input),
            Event::LineFeed => return None,
            Event::Exit => return None,
            Event::VerbatimEscaping { content, .. } => content.content(input),
            Event::EnterParagraph => return None,
            Event::ThematicBreak => return None,
            Event::EnterCodeBlock => return None,
            Event::EnterCodeBlockMeta => return None,
            Event::EnterCodeBlockContent => return None,
        };

        Some(result)
    }
}
