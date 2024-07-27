use crate::{
    block::{context::Context, sub_parsers},
    common::Range,
    events::{BlockEvent, NewLine},
};

enum State {
    Initial(Option<Range>),
    Content(Box<sub_parsers::content::Parser>),
    Exiting,
    Exited,

    Paused(Box<sub_parsers::content::Parser>),
    /// 此状态仅在实现
    /// [sub_parsers::SubParser::resume_from_pause_for_new_line_and_exit] 时设置。
    /// 其他情况下会直接进入 [State::Exiting]。
    ToExit,

    Invalid,
}

pub struct Parser {
    state: State,
}

impl Parser {
    /// XXX: 不会尝试解析 `content_before` 中的内容，而是直接把这些内容当成文本。
    pub fn new(content_before: Option<Range>) -> Self {
        Self {
            state: State::Initial(content_before),
        }
    }

    #[inline(always)]
    fn next(&mut self, ctx: &mut Context) -> sub_parsers::Result {
        let ret: sub_parsers::Result;

        let state = std::mem::replace(&mut self.state, State::Invalid);
        (ret, self.state) = match state {
            State::Initial(content_before) => {
                let opts = sub_parsers::content::Options {
                    initial_step_state: match content_before {
                        Some(content_before) => {
                            sub_parsers::content::StepState::Normal(content_before)
                        }
                        None => sub_parsers::content::StepState::Initial,
                    },
                    end_conditions: sub_parsers::content::EndConditions {
                        before_blank_line: true,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let parser = sub_parsers::content::Parser::new(opts);
                (
                    sub_parsers::Result::ToYield(BlockEvent::EnterParagraph),
                    State::Content(Box::new(parser)),
                )
            }
            State::Content(mut content_parser) => {
                let next = content_parser.next(ctx);
                match next {
                    sub_parsers::Result::ToYield(ev) => (
                        sub_parsers::Result::ToYield(ev),
                        State::Content(content_parser),
                    ),
                    sub_parsers::Result::ToPauseForNewLine => (
                        sub_parsers::Result::ToPauseForNewLine,
                        State::Paused(content_parser),
                    ),
                    sub_parsers::Result::Done => (
                        sub_parsers::Result::ToYield(BlockEvent::Exit),
                        State::Exiting,
                    ),
                }
            }
            State::Exiting => (sub_parsers::Result::Done, State::Exited),
            // 当解析器作为迭代器被耗尽而返回 `None` 时，解析器进入状态
            // [State::Exited]。此后，不应该再调用 `next` 方法，否则就会执行到
            // 这里。正确的做法是 `take_context` 取回 [Context]，并将解析器
            // drop 掉。
            State::Exited | State::Paused(_) | State::Invalid => unreachable!(),
            State::ToExit => (
                sub_parsers::Result::ToYield(BlockEvent::Exit),
                State::Exiting,
            ),
        };

        ret
    }
}

impl<'a> sub_parsers::SubParser<'a> for Parser {
    fn next(&mut self, ctx: &mut Context<'a>) -> sub_parsers::Result {
        self.next(ctx)
    }

    fn resume_from_pause_for_new_line_and_continue(&mut self, new_line: NewLine) {
        let state = std::mem::replace(&mut self.state, State::Invalid);
        let State::Paused(mut content_parser) = state else {
            unreachable!()
        };
        content_parser.resume_from_pause_for_new_line_and_continue(new_line);
        self.state = State::Content(content_parser);
    }

    fn resume_from_pause_for_new_line_and_exit(&mut self) {
        if matches!(self.state, State::Paused(_)) {
            self.state = State::ToExit;
        } else {
            unreachable!()
        }
    }
}
