import { Component } from "solid-js";
import { Dropdown, DropdownItem, Radio } from "./ui";
import {
  HiSolidArrowTopRightOnSquare,
  HiSolidChevronDown,
} from "solid-icons/hi";

export const NavBar: Component = () => {
  return (
    <div class="navbar bg-base-100 shadow-xl rounded-box">
      <div class="flex-1 flex items-center">
        <Dropdown
          summary={
            <>
              团岛计划<HiSolidChevronDown size={16} />
            </>
          }
          buttonClass="btn-ghost"
          contentClass="border-[0.5px] border-black"
        >
          <DropdownItem>
            <a>轻量级标记语言 Rotext（当前）</a>
          </DropdownItem>
          <DropdownItem>
            <a href="https://umajho.github.io/dicexp">骰子表达式 Dicexp</a>
          </DropdownItem>
        </Dropdown>
        <a class="btn btn-ghost normal-case text-xl">
          <span>
            Rotext<sup>lite</sup> Playground
          </span>
        </a>
      </div>
      <div class="flex-none">
        <ul class="menu menu-horizontal px-1">
          <li>
            <a
              class="inline-flex items-center"
              href="https://github.com/umajho/rotext-lite"
            >
              代码仓库
              <HiSolidArrowTopRightOnSquare size={16} />
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
};
