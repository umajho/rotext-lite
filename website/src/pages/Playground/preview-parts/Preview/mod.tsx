import {
  Component,
  createEffect,
  createSignal,
  JSX,
  on,
  onMount,
  Show,
} from "solid-js";

// @ts-ignore
import { Idiomorph } from "idiomorph/dist/idiomorph.esm.js";

import {
  ErrorAlert,
  registerRoWidgetOwner,
} from "@rotext/solid-components/internal";

import { debounceEventHandler } from "../../../../utils/mod";
import {
  PROSE_CLASS,
  registerCustomElementsOnce,
  WIDGET_OWNER_CLASS,
} from "../../../../utils/custom-elements-registration/mod";

import {
  ActiveLines,
  EditorStore,
  TopLine,
} from "../../../../hooks/editor-store";
import { createAutoResetCounter } from "../../../../hooks/auto-reset-counter";
import { RotextProcessResult } from "../../../../processors/mod";

import { LookupList, LookupListRaw } from "./internal-types";
import * as ScrollUtils from "./scroll-utils";

registerCustomElementsOnce();

const CONTENT_ROOT_CLASS = "previewer-content-root";

const Preview: Component<
  {
    store: EditorStore;
    processResult: RotextProcessResult;

    class?: string;
  }
> = (props) => {
  let scrollContainerEl!: HTMLDivElement;
  let widgetAnchorEl!: HTMLDivElement;
  let outputContainerEl!: HTMLDivElement;
  let outputEl!: HTMLElement;

  const [scrollHandler, setScrollHandler] = createSignal<(ev: Event) => void>();

  const [highlightElement, setHighlightElement] = createSignal<JSX.Element>();

  onMount(() => {
    const [lookupList, setLookupListRaw] = createLookupList({
      scrollContainer: scrollContainerEl,
      outputContainer: outputContainerEl,
    });

    { //==== 文档渲染 ====
      createEffect(on([() => props.processResult.html], ([html]) => {
        if (!html) {
          outputEl.innerText = "";
          setLookupListRaw([]);
          return;
        }

        Idiomorph.morph(outputEl, html, { morphStyle: "innerHTML" });

        const lookupListRaw: LookupListRaw = [];
        for (const el_ of outputEl.querySelectorAll("[data-sourcemap]")) {
          const el = el_ as HTMLElement;
          const [startLnStr, endLnStr] = el.dataset["sourcemap"]!.split("-");
          lookupListRaw.push({
            element: el,
            location: {
              start: { line: Number(startLnStr) },
              end: { line: Number(endLnStr) },
            },
          });
        }
        setLookupListRaw(lookupListRaw);
      }));
    }

    //==== 滚动同步 ====
    const { handleScroll } = createScrollSyncing({
      inputChangeNotifier: () => props.processResult,
      topLine: () => props.store.topLine,
      setTopLine: (v) => props.store.topLine = v,
      lookupList,
    }, {
      scrollContainer: scrollContainerEl,
      outputContainer: outputContainerEl,
    });
    setScrollHandler(() => debounceEventHandler(handleScroll));

    //==== 活动行对应元素高亮 ====
    setUpHighlight({
      activeLines: () => props.store.activeLines,
      lookupList: lookupList,
      setHighlightElement,
    });

    //==== 注册进全局存储 ====
    {
      const cbs = new Set<() => void>();
      const layoutChangeObserver = {
        subscribe: (cb: () => void) => cbs.add(cb),
        unsubscribe: (cb: () => void) => cbs.delete(cb),
      };

      // NOTE: 目前 scrollContainerEl 就是 previewer 的元素
      registerRoWidgetOwner(scrollContainerEl, {
        widgetAnchorElement: widgetAnchorEl,
        level: 1,
        layoutChangeObserver,
      });
      createEffect(
        on([lookupList], () => [...cbs].forEach((cb) => cb())),
      );
    }
  });

  //==== 组件 ====
  return (
    <div
      class={[
        `previewer ${WIDGET_OWNER_CLASS}`,
        "relative tuan-background overflow-y-auto",
        props.class,
      ].join(" ")}
      ref={scrollContainerEl}
      onScroll={(ev) => scrollHandler()!(ev)}
    >
      <Show when={props.processResult.error}>
        {(err) => <ErrorAlert message={err().message} stack={err().stack} />}
      </Show>

      {/* highlight anchor */}
      <div class="relative">{highlightElement()}</div>

      <div class="relative z-10" ref={widgetAnchorEl} />

      <div
        class={"" +
          "relative " + // 作为计算元素高度位移的锚点
          "self-center mx-auto " + // 保持居中，以及撑起父元素
          "break-all " + // 内容的外观样式
          `${PROSE_CLASS} ` +
          ""}
      >
        <div ref={outputContainerEl}>
          <article ref={outputEl} class={`relative ${CONTENT_ROOT_CLASS}`} />
        </div>
      </div>
    </div>
  );
};
export default Preview;

function createLookupList(
  els: { scrollContainer: HTMLElement; outputContainer: HTMLElement },
) {
  const [lookupListRaw, setLookupListRaw] = createSignal<LookupListRaw>([]);
  const [lookupList, setLookupList] = createSignal<LookupList>([]);
  function roastLookupList() {
    const _raw = lookupListRaw();
    if (!_raw) return;
    setLookupList(ScrollUtils.roastLookupList(_raw, CONTENT_ROOT_CLASS));
  }
  createEffect(on([lookupListRaw], roastLookupList));
  onMount(() => {
    const observer = new ResizeObserver(roastLookupList);
    observer.observe(els.scrollContainer);
    observer.observe(els.outputContainer);
  });

  return [lookupList, setLookupListRaw] as const;
}

/**
 * 用于处理滚动同步。
 */
function createScrollSyncing(
  props: {
    inputChangeNotifier: () => void;
    topLine: () => TopLine;
    setTopLine: (v: TopLine) => void;
    lookupList: () => LookupList;
  },
  els: {
    scrollContainer: HTMLElement;
    outputContainer: HTMLElement;
  },
) {
  const [pendingAutoScrolls, setPendingAutoScrolls] = createAutoResetCounter();

  {
    const [wasAtBottom, setWasAtBottom] = createSignal<boolean>(false);
    setWasAtBottom(ScrollUtils.isAtBottom(els.scrollContainer));
    (new ResizeObserver(() =>
      setWasAtBottom(ScrollUtils.isAtBottom(els.scrollContainer))
    )).observe(els.outputContainer);

    function scrollToTopLine(opts?: { triggeredBy?: "text-changes" }) {
      const topLineData = props.topLine();
      if (!topLineData.setFrom || topLineData.setFrom === "preview") {
        return;
      }

      const _lookupList = props.lookupList();
      if (!_lookupList.length) return;

      if (!Number.isFinite(topLineData.number)) { // 编辑器要求预览滚动到最底部
        const maxTop = els.scrollContainer.scrollHeight -
          els.scrollContainer.offsetHeight;
        if (maxTop < 0) return;

        const scrollLocal = ScrollUtils.getScrollLocalByY(
          _lookupList,
          maxTop,
          els.outputContainer.offsetHeight,
        );
        const line = ScrollUtils.scrollLocalToLine(scrollLocal, _lookupList);
        props.setTopLine({ number: line, setFrom: "editor" });
        return;
      }

      const scrollResult = ScrollUtils.scrollToLine(
        topLineData.number,
        _lookupList,
        els.scrollContainer,
        wasAtBottom,
        setWasAtBottom,
        { triggeredBy: opts?.triggeredBy },
      );
      if (scrollResult === "scrolled") {
        setPendingAutoScrolls.increase();
      }
    }

    // NOTE: 即使与之前相同也要处理，以在编辑器滚动到预览无法继续同步滚动的位置之下时，
    //       在使预览的高度增加而导致可以继续滚动的位置向下延伸时，预览可以同步位置。
    createEffect(on([props.topLine], () => scrollToTopLine()));
    createEffect(
      on(
        [props.inputChangeNotifier],
        () => scrollToTopLine({ triggeredBy: "text-changes" }),
      ),
    );
  }

  /**
   * @param scrollContainerEl 滚动内容的容器元素。
   *  除了预览内容之外，还包含可能存在的错误展示等内容。
   */
  function handleScroll(_ev: Event) {
    if (pendingAutoScrolls() > 0) {
      setPendingAutoScrolls.decrease();
      return;
    }

    const _lookupList = props.lookupList();
    if (!_lookupList?.length) return;

    const _baselineY = els.scrollContainer.scrollTop -
      els.outputContainer.offsetTop;

    const scrollLocal = ScrollUtils.getScrollLocalByY(
      _lookupList,
      _baselineY,
      els.outputContainer.offsetHeight,
    );
    const line = ScrollUtils.scrollLocalToLine(scrollLocal, _lookupList);

    {
      // 配合编辑器的 “滚动过最后一行” 功能。
      // 否则在当编辑文本，导致预览的高度改变时，编辑器的滚动位置也会复位。
      const lastTopLine = props.topLine();
      if (
        ScrollUtils.isAtBottom(els.scrollContainer) &&
        lastTopLine.setFrom === "editor" &&
        line <= lastTopLine.number
      ) {
        return;
      }
    }

    props.setTopLine({ number: line, setFrom: "preview" });
  }

  return { handleScroll };
}

function setUpHighlight(
  props: {
    activeLines: () => ActiveLines | null;
    lookupList: () => LookupList;
    setHighlightElement: (v: () => JSX.Element) => void;
  },
) {
  const [topPx, setTopPx] = createSignal<number>();
  const [heightPx, setHeightPx] = createSignal<number>();

  const el = () => (
    <Show when={props.activeLines()}>
      <div
        class="absolute w-full"
        style={{
          "background-color": "rgb(255, 255, 0, 5%)",
          top: `${topPx()}px`,
          height: `${heightPx()}px`,
        }}
      />
    </Show>
  );

  createEffect(on([props.activeLines, props.lookupList], () => {
    const lookupList_ = props.lookupList();
    if (!lookupList_?.length) return;
    const activeLines_ = props.activeLines();
    if (!activeLines_) return;

    const topLineIndex =
      ScrollUtils.getScrollLocalByLine(lookupList_, activeLines_[0])
        .indexInLookupList;
    const bottomLineIndex = activeLines_[0] === activeLines_[1]
      ? topLineIndex
      : ScrollUtils.getScrollLocalByLine(lookupList_, activeLines_[1])
        .indexInLookupList;

    const topLineItem = lookupList_[topLineIndex]!;
    const bottomLineItem = topLineIndex === bottomLineIndex
      ? topLineItem
      : lookupList_[bottomLineIndex]!;

    setTopPx(topLineItem.offsetTop);
    setHeightPx(
      bottomLineItem.offsetTop + bottomLineItem.element.offsetHeight -
        topLineItem.offsetTop,
    );
  }));

  props.setHighlightElement(el);
}
