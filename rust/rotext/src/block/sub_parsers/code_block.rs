use crate::{
    block::{context::Context, sub_parsers, Event},
    global,
};

enum State {
    /// 构造解析器后，解析器所处的初始状态。此时，其所解析语法的开启部分应已经被
    /// 消耗。
    Initial,
    InfoStringContent(Box<sub_parsers::content::Parser>),
    CodeContent(Box<sub_parsers::content::Parser>),
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
    leading_backticks: usize,

    state: State,
}

impl Parser {
    pub fn new(leading_backticks: usize) -> Self {
        Self {
            leading_backticks,

            state: State::Initial,
        }
    }

    #[inline(always)]
    fn next<'a, I: 'a + Iterator<Item = global::Event>>(
        &mut self,
        ctx: &mut Context<'a, I>,
    ) -> sub_parsers::Result {
        let ret: sub_parsers::Result;

        let state = std::mem::replace(&mut self.state, State::Invalid);
        (ret, self.state) = match state {
            State::Initial => {
                let opts = sub_parsers::content::Options {
                    mode: sub_parsers::content::Mode::Verbatim,
                    end_conditions: sub_parsers::content::EndConditions {
                        before_new_line: true,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let info_string_parser = sub_parsers::content::Parser::new(opts);
                (
                    sub_parsers::Result::ToYield(Event::EnterCodeBlock),
                    State::InfoStringContent(Box::new(info_string_parser)),
                )
            }
            State::InfoStringContent(mut info_string_content_parser) => {
                let next = info_string_content_parser.next(ctx);
                match next {
                    sub_parsers::Result::ToYield(ev) => (
                        sub_parsers::Result::ToYield(ev),
                        State::InfoStringContent(info_string_content_parser),
                    ),
                    sub_parsers::Result::ToPauseForNewLine => unreachable!(),
                    sub_parsers::Result::Done => {
                        let opts = sub_parsers::content::Options {
                            is_at_line_beginning: true,
                            mode: sub_parsers::content::Mode::Verbatim,
                            end_conditions: sub_parsers::content::EndConditions {
                                at_end_of_leading_repetitive_characters_at_new_line: Some(
                                    sub_parsers::content::RepetitiveCharactersCondition {
                                        character: b'`',
                                        minimal_count: self.leading_backticks,
                                    },
                                ),
                                ..Default::default()
                            },
                        };
                        let code_content_parser = sub_parsers::content::Parser::new(opts);
                        (
                            sub_parsers::Result::ToYield(Event::Separator),
                            State::CodeContent(Box::new(code_content_parser)),
                        )
                    }
                }
            }
            State::CodeContent(mut code_content_parser) => {
                let next = code_content_parser.next(ctx);
                match next {
                    sub_parsers::Result::ToYield(ev) => (
                        sub_parsers::Result::ToYield(ev),
                        State::CodeContent(code_content_parser),
                    ),
                    sub_parsers::Result::ToPauseForNewLine => (
                        sub_parsers::Result::ToPauseForNewLine,
                        State::Paused(code_content_parser),
                    ),
                    sub_parsers::Result::Done => {
                        (sub_parsers::Result::ToYield(Event::Exit), State::Exiting)
                    }
                }
            }
            State::Exiting => (sub_parsers::Result::Done, State::Exited),
            // 当解析器作为迭代器被耗尽而返回 `None` 时，解析器进入状态
            // [State::Exited]。此后，不应该再调用 `next` 方法，否则就会执行到
            // 这里。正确的做法是 `take_context` 取回 [Context]，并将解析器
            // drop 掉。
            State::Exited | State::Paused(_) | State::Invalid => unreachable!(),
            State::ToExit => (sub_parsers::Result::ToYield(Event::Exit), State::Exiting),
        };

        ret
    }
}

impl<'a, I: 'a + Iterator<Item = global::Event>> sub_parsers::SubParser<'a, I> for Parser {
    fn next(&mut self, ctx: &mut Context<'a, I>) -> sub_parsers::Result {
        self.next(ctx)
    }

    fn resume_from_pause_for_new_line_and_continue(&mut self) {
        let state = std::mem::replace(&mut self.state, State::Invalid);
        let State::Paused(mut content_parser) = state else {
            unreachable!()
        };
        content_parser.resume_from_pause_for_new_line_and_continue();
        self.state = State::CodeContent(content_parser);
    }

    fn resume_from_pause_for_new_line_and_exit(&mut self) {
        if matches!(self.state, State::Paused(_)) {
            self.state = State::ToExit;
        } else {
            unreachable!()
        }
    }
}