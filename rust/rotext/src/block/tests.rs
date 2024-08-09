#![cfg(test)]

use std::marker::PhantomData;

use crate::{
    events::EventType,
    global,
    test_suites::{
        self,
        block::support::{
            assert_parse_error_with_stack, assert_parse_ok_and_output_maches_with_stack,
        },
    },
    utils::stack::{ArrayStack, Stack, VecStack},
    Error,
};

use super::{Parser, StackEntry};

struct Context<TStack: Stack<StackEntry>> {
    phantom_stack: PhantomData<TStack>,
}
impl<TStack: Stack<StackEntry>> Context<TStack> {
    fn new() -> Self {
        Self {
            phantom_stack: PhantomData::<TStack>,
        }
    }
}
impl<TStack: Stack<StackEntry>> test_suites::block::Context for Context<TStack> {
    fn parse(input: &str) -> impl Iterator<Item = crate::Result<crate::BlockEvent>> {
        let global_parser =
            global::Parser::new(input.as_bytes(), global::NewParserOptions::default());
        let block_parser: Parser<TStack> = Parser::new(input.as_bytes(), global_parser);

        block_parser
    }
}

#[test]
fn it_works() {
    let ctx: Context<VecStack<_>> = Context::new();
    test_suites::block::run(&ctx);
}

#[test]
fn it_works_with_array_stack() {
    let ctx: Context<ArrayStack<_, 2>> = Context::new();

    assert_parse_ok_and_output_maches_with_stack(&ctx, "", &vec![]);
    assert_parse_ok_and_output_maches_with_stack(
        &ctx,
        ">",
        &vec![
            (EventType::EnterBlockQuote, None),
            (EventType::ExitBlock, None),
        ],
    );
    assert_parse_ok_and_output_maches_with_stack(
        &ctx,
        "> >",
        &vec![
            (EventType::EnterBlockQuote, None),
            (EventType::EnterBlockQuote, None),
            (EventType::ExitBlock, None),
            (EventType::ExitBlock, None),
        ],
    );
    assert_parse_ok_and_output_maches_with_stack(
        &ctx,
        "> > foo",
        &vec![
            (EventType::EnterBlockQuote, None),
            (EventType::EnterBlockQuote, None),
            (EventType::EnterParagraph, None),
            (EventType::Unparsed, Some("foo")),
            (EventType::ExitBlock, None),
            (EventType::ExitBlock, None),
            (EventType::ExitBlock, None),
        ],
    );
    assert_parse_error_with_stack(&ctx, "> > >", Error::OutOfStackSpace)
}