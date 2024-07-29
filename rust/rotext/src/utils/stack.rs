use std::mem::MaybeUninit;

use crate::Error;

pub trait Stack<T> {
    fn new() -> Self;
    /// 将 `item` 推入栈中，返回是否成功推入（栈已满时失败）。
    fn try_push(&mut self, item: T) -> Result<(), Error>;
    fn pop(&mut self) -> Option<T>;
    fn as_slice(&self) -> &[T];
}

pub struct VecStack<T> {
    items: Vec<T>,
}
impl<T> Stack<T> for VecStack<T> {
    fn new() -> Self {
        Self { items: vec![] }
    }

    fn try_push(&mut self, item: T) -> Result<(), Error> {
        self.items.push(item);
        Ok(())
    }

    fn pop(&mut self) -> Option<T> {
        self.items.pop()
    }

    fn as_slice(&self) -> &[T] {
        &self.items
    }
}

pub struct ArrayStack<T, const N: usize> {
    items: [T; N],
    len: usize,
}
impl<T, const N: usize> Stack<T> for ArrayStack<T, N> {
    fn new() -> Self {
        Self {
            items: unsafe {
                #[allow(clippy::uninit_assumed_init)]
                MaybeUninit::uninit().assume_init()
            },
            len: 0,
        }
    }

    fn try_push(&mut self, item: T) -> Result<(), Error> {
        if self.len == N {
            Err(Error::OutOfStackSpace)
        } else {
            self.items[self.len] = item;
            self.len += 1;
            Ok(())
        }
    }

    fn pop(&mut self) -> Option<T> {
        if self.len == 0 {
            None
        } else {
            self.len -= 1;
            Some(std::mem::replace(&mut self.items[self.len], unsafe {
                #[allow(clippy::uninit_assumed_init)]
                MaybeUninit::uninit().assume_init()
            }))
        }
    }

    fn as_slice(&self) -> &[T] {
        &self.items[0..self.len]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn array_stack_works() {
        let mut s = ArrayStack::<usize, 2>::new();
        assert!(s.pop().is_none());
        assert!(s.try_push(1).is_ok());
        assert!(s.try_push(2).is_ok());
        assert!(s.try_push(3).is_err());
        assert_eq!(s.pop(), Some(2));
        assert_eq!(s.pop(), Some(1));
        assert!(s.try_push(4).is_ok());
    }
}
