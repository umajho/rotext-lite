import "./previewer.scss";

import {
  Component,
  createEffect,
  createMemo,
  createSignal,
  onMount,
  Setter,
  Show,
  untrack,
} from "solid-js";

import { Alert, Badge, BadgeBar, Card, Tab, Tabs } from "./ui";

import { classModule, init, styleModule, type VNode } from "snabbdom";

import { parse } from "@rotext-lite/renderer-snabbdom";

import rotextExample from "../example.rotext?raw";

export const Main: Component = () => {
  const [text, setText] = createSignal(rotextExample);

  return (
    <main>
      <div
        class={`
        flex justify-center flex-col lg:flex-row
        items-center lg:items-stretch gap-8
      `}
      >
        <EditorCard text={text()} setText={setText} />
        <ViewerCard code={text()} />
      </div>
    </main>
  );
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const textEncoder = new TextEncoder();

export const EditorCard: Component<
  { text: string; setText: Setter<string> }
> = (props) => {
  const charCount = () => [...segmenter.segment(props.text)].length;
  const byteCount = () => textEncoder.encode(props.text).length;

  return (
    <Card class="w-full max-w-[48rem] lg:w-[36rem] lg:max-h-[80vh]">
      <BadgeBar class="pb-2">
        <Badge>字数：{charCount()}</Badge>
        <Badge>字节数：{byteCount()}</Badge>
      </BadgeBar>
      <textarea
        class=" h-full min-h-[25vh] lg:min-h-[20rem] resize-none"
        placeholder="于此处输入…"
        value={props.text}
        onInput={(ev) => props.setText(ev.target.value)}
      />
    </Card>
  );
};

export const ViewerCard: Component<{ code: string }> = (props) => {
  let outputEl: HTMLDivElement;
  let patch: ReturnType<typeof init>;
  let lastNode: HTMLElement | VNode;

  const [parsingTime, setParsingTime] = createSignal<number>(null);
  const [errParse, setErrParse] = createSignal<unknown>(null);
  const errParseInfo = createMemo(() => {
    const errParseValue = errParse();
    if (errParseValue === null) return null;
    return extractInfoFromThrown(errParseValue, "解析期间");
  });

  onMount(() => {
    patch = init(
      [classModule, styleModule],
      undefined,
      { experimental: { fragments: true } },
    );
    lastNode = outputEl;
  });

  createEffect(() => {
    try {
      if (untrack(() => errParse()) !== null) {
        setErrParse(null);
      }

      const parsingStart = performance.now();
      const vNode = parse(props.code, { breaks: true });
      setParsingTime(performance.now() - parsingStart);

      patch(lastNode, vNode);
      lastNode = vNode;
    } catch (e) {
      setErrParse(e);
    }
  });

  return (
    <Card class="w-full max-w-[48rem] lg:w-[36rem] lg:max-h-[80vh]">
      <Show when={errParseInfo() !== null}>
        <Alert
          type="error"
          title={errParseInfo().title}
          message={errParseInfo().message}
          details={errParseInfo().details}
        />
      </Show>
      <div class="flex justify-between items-center">
        <Tabs>
          <Tab isActive={true}>预览</Tab>
        </Tabs>
        <BadgeBar>
          <Badge>解析时间：{parsingTime()}ms</Badge>
        </BadgeBar>
      </div>
      <div class="h-full max-h-[25vh] lg:max-h-none break-all prose previewer overflow-y-auto">
        <div ref={outputEl} />
      </div>
    </Card>
  );
};

function extractInfoFromThrown(thrown: unknown, when: string): {
  title: string;
  message: string;
  details?: string;
} {
  if (thrown instanceof Error) {
    return {
      title: when + "发生了错误",
      message: thrown.message,
      details: thrown.stack,
    };
  } else {
    return {
      title: when + "抛出了并非 `Error` 实例的值",
      message: `${thrown}`,
    };
  }
}