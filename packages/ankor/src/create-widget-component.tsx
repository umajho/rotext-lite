import {
  Accessor,
  batch,
  Component,
  createEffect,
  createMemo,
  createSignal,
  JSX,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { Portal } from "solid-js/web";

import { findClosestElementEx } from "@rolludejo/internal-web-shared/dom";
import {
  adoptStyle,
  StyleProvider,
} from "@rolludejo/internal-web-shared/shadow-root";

import {
  ComputedColor,
  computedColorToCSSValue,
  getSizeInPx,
} from "@rolludejo/internal-web-shared/styling";

import { createWidgetOwnerAgent, WidgetOwnerAgent } from "./widget-owner-agent";
import { mixColor } from "./utils";
import CollapseMaskLayer from "./CollapseMaskLayer";
import PopperContainer from "./PopperContainer";
import { NO_AUTO_OPEN_CLASS } from "./consts";

const LEAVING_DELAY_MS = 100;

const COLLAPSE_HEIGHT_PX = getSizeInPx("6rem");

export type DisplayMode = "closed" | "floating" | "pinned";

export interface LabelContentComponent {
  cursor: JSX.CSSProperties["cursor"];

  onTogglePopper?: () => void;
}

export interface PopperContainerProperties {
  ref: HTMLDivElement | undefined;

  class?: string;
  style?: JSX.CSSProperties;

  onMouseEnter: () => void;
  onMouseLeave: () => void;

  children: JSX.Element;
}

export interface PopperContentProperties {
  displayMode: () => DisplayMode;
  /**
   * XXX: 只有在挂载后（执行 `onMount` 起）才被定义（不为 `undefined`）。
   */
  widgetOwnerAgentGetter: () => WidgetOwnerAgent | undefined;

  handlerForTouchEndOnPinIcon: () => void;
  handlerForClickOnPinIcon: () => void;
}

interface ElementSize {
  widthPx: number;
  heightPx: number;
}

interface ElementPosition {
  topPx: number;
  leftPx: number;
}

export function createWidgetComponent(parts: {
  LabelContent: Component<LabelContentComponent>;
  PopperContent: Component<PopperContentProperties>;
}, opts: {
  baseStyleProviders?: StyleProvider[];
  openable?: () => boolean;
  autoOpenable?: boolean;
  autoOpenShouldCollapse?: boolean;

  popperBackgroundColor: () => ComputedColor;
  maskTintColor: () => ComputedColor;
}): Component {
  opts.openable ??= () => true;
  opts.autoOpenShouldCollapse ??= true;

  const { LabelContent, PopperContent } = parts;

  let rootEl!: HTMLDivElement;

  // 在执行 handleMount 时必定存在
  let labelEl!: HTMLSpanElement;
  // 视情况存在
  let popperContainerEl: HTMLDivElement,
    popperEl: HTMLDivElement;

  const backgroundColorCSSValue = createMemo(() =>
    computedColorToCSSValue(opts.popperBackgroundColor())
  );

  const [woAgent, setWOAgent] = createSignal<WidgetOwnerAgent>();

  const [popperPosition, setPopperPosition] = //
    createSignal<ElementPosition | null>({ topPx: 0, leftPx: 0 });

  const [canCollapse, setCanCollapse] = createSignal(false);

  const maskBaseColor = createMemo((): ComputedColor =>
    mixColor(opts.popperBackgroundColor(), 2 / 3, opts.maskTintColor(), 1 / 3)
  );

  const {
    displayMode,
    collapsed,
    enterHandler,
    leaveHandler,
    pinningTogglerTouchEndHandler,
    pinningToggleHandler,
    labelClickHandler,
    autoOpen,
    expand,
  } = createDisplayModeFSM({
    initialDisplayMode: "closed",
    openable: opts.openable,
    collapsible: canCollapse,
  });

  const [popperWidthPx, setPopperWidthPx] = createSignal<number | null>(null);
  const [popperHeightPx, setPopperHeightPx] = createSignal<number | null>(null);

  onMount(() => {
    const shadowRoot = rootEl.getRootNode() as ShadowRoot;
    const woAgent = createWidgetOwnerAgent(shadowRoot.host as HTMLElement);
    setWOAgent(woAgent);

    { //==== 采纳样式 ====
      if (opts.baseStyleProviders) {
        for (const p of opts.baseStyleProviders) {
          adoptStyle(shadowRoot, p);
        }
      }
    }

    { //==== 持续计算悬浮框位置 ====
      function handleLayoutChange() {
        const popperWidthPxOnce = untrack(popperWidthPx);
        if (popperWidthPxOnce !== null) {
          // 代表此时悬浮框还未准备好。将由追踪 signal `popperWidthPx` 的
          // `createEffect` 来处理后续准备好时的情况。

          updatePopperPosition(popperWidthPxOnce);
        }
      }
      function updatePopperPosition(popperWidthPx: number) {
        setPopperPosition(
          calculatePopperPosition({
            label: labelEl,
            popperAnchor: woAgent.anchorElement,
          }, { popperWidthPx }),
        );
      }
      createEffect(on(
        [() => displayMode() === "closed"],
        ([isClosed]) => {
          woAgent.layoutChangeObserver
            [isClosed ? "unsubscribe" : "subscribe"](handleLayoutChange);
          if (!isClosed) {
            handleLayoutChange();
          }
        },
      ));
      onCleanup(() =>
        woAgent.layoutChangeObserver.unsubscribe(handleLayoutChange)
      );
      createEffect(on([popperWidthPx], ([popperWidthPx]) => {
        if (popperWidthPx !== null) {
          updatePopperPosition(popperWidthPx);
        }
      }));
    }

    //==== 同步元素大小 ====
    if (opts.openable) { // 确认 openable 这个 “决定能否打开的函数” 在不在。
      // 挂件内容的大小，目前只有在需要折叠时才需要侦测（判断是否能折叠）；
      const { size: popperSize } = createSizeSyncer(
        () => popperEl,
        { enabled: () => displayMode() !== "closed" },
      );
      createEffect(on(
        [popperSize],
        ([size]) => setCanCollapse((size?.heightPx ?? 0) > COLLAPSE_HEIGHT_PX),
      ));
      // 挂件容器的大小（比如用来确定遮盖的高度）。
      const { size: popperContainerSize } = createSizeSyncer(
        () => popperContainerEl,
        { enabled: () => displayMode() !== "closed" },
      );
      createEffect(on(
        [popperContainerSize],
        ([size]) => {
          batch(() => {
            setPopperWidthPx(size?.widthPx ?? null);
            setPopperHeightPx(size?.heightPx ?? null);
          });
        },
      ));
    }

    //==== 自动打开 ====
    if (
      opts.autoOpenable &&
      woAgent.level === 1 &&
      !findClosestElementEx(
        labelEl,
        (el) => el.classList.contains(NO_AUTO_OPEN_CLASS),
      )
    ) {
      autoOpen(!!opts.autoOpenShouldCollapse);
    }

    //==== Workarounds ====
    if (opts.openable) { // 确认 openable 这个 “决定能否打开的函数” 在不在。
      // 套入 ShadowRootAttacher 后，“直接在 JSX 上视情况切换事件处理器与
      // undefined” 的方案对 Dicexp 失效了（但对 RefLink 还有效）。这里通过手动添
      // 加/去处来 workaround。
      createEffect(on([opts.openable], ([openable]) => {
        if (openable) {
          labelEl.addEventListener("mouseenter", enterHandler);
          labelEl.addEventListener("mouseleave", leaveHandler);
        } else {
          labelEl.removeEventListener("mouseenter", enterHandler);
          labelEl.removeEventListener("mouseleave", leaveHandler);
        }
      }));
    }
  });

  function handlePortalRef({ shadowRoot }: { shadowRoot: ShadowRoot }) {
    if (opts.baseStyleProviders) {
      for (const p of opts.baseStyleProviders) {
        adoptStyle(shadowRoot, p);
      }
    }
  }

  return () => {
    return (
      <div ref={rootEl} style={{ display: "inline-grid" }}>
        <span ref={labelEl} class="widget-label">
          <LabelContent
            cursor={opts.openable?.()
              ? (displayMode() === "pinned"
                ? (canCollapse()
                  ? (collapsed() ? "zoom-in" : "zoom-out")
                  : undefined)
                : "zoom-in")
              : undefined}
            onTogglePopper={opts.openable?.() ? labelClickHandler : undefined}
          />
        </span>

        <Dummy
          shouldBeShown={displayMode() === "pinned"}
          widthPx={popperWidthPx()}
          heightPx={popperHeightPx()}
        />
        <Portal
          ref={handlePortalRef}
          mount={woAgent()?.anchorElement}
          useShadow={true}
        >
          <Show when={displayMode() !== "closed"}>
            <PopperContainer
              ref={popperContainerEl}
              style={{
                position: "absolute",
                ...(((pos) =>
                  pos
                    ? { transform: `translate(${pos.leftPx}px,${pos.topPx}px)` }
                    : { display: "none" })(popperPosition())),
                "background-color": backgroundColorCSSValue(),
                ...(collapsed() &&
                  {
                    "overflow-y": "hidden",
                    height: `${COLLAPSE_HEIGHT_PX}px`,
                  }),
                ...(displayMode() === "floating" && { "z-index": 10 }),
              }}
              onMouseEnter={enterHandler}
              onMouseLeave={leaveHandler}
            >
              <Show when={collapsed()}>
                <CollapseMaskLayer
                  containerHeightPx={popperHeightPx()}
                  backgroundColor={maskBaseColor()}
                  onExpand={expand}
                />
              </Show>
              <div ref={popperEl}>
                <PopperContent
                  displayMode={displayMode}
                  widgetOwnerAgentGetter={() => untrack(woAgent)}
                  handlerForTouchEndOnPinIcon={pinningTogglerTouchEndHandler}
                  handlerForClickOnPinIcon={pinningToggleHandler}
                />
              </div>
            </PopperContainer>
          </Show>
        </Portal>
      </div>
    );
  };
}

const Dummy: Component<{
  shouldBeShown: boolean;
  widthPx: number | null;
  heightPx: number | null;
}> = (props) => {
  return (
    <div
      style={{
        ...(!props.shouldBeShown && { display: "none" }),
        ...(props.widthPx && { width: `${props.widthPx}px` }),
        ...(props.heightPx && { height: `${props.heightPx}px` }),
      }}
    />
  );
};

function calculatePopperPosition(
  els: {
    label: HTMLElement;
    popperAnchor: HTMLElement;
  },
  opts: {
    popperWidthPx: number;
  },
): ElementPosition | null {
  if (!els.label.offsetParent) {
    // 为 null 代表在设有 `display: none` 的元素的内部。
    // see: https://stackoverflow.com/a/21696585
    return null;
  }

  const labelRect = els.label.getBoundingClientRect();
  const anchorRect = els.popperAnchor.getBoundingClientRect();

  return {
    topPx: labelRect.bottom - anchorRect.top,
    leftPx: Math.min(
      labelRect.left - anchorRect.left,
      anchorRect.width - opts.popperWidthPx,
    ),
  };
}

function createDisplayModeFSM(
  opts: {
    initialDisplayMode: DisplayMode;
    openable: () => boolean;
    collapsible: () => boolean | null;
  },
) {
  const [displayMode, setDisplayMode] = createSignal(opts.initialDisplayMode);
  const [collapsed, setCollapsed] = createSignal(false);

  const [delayedAutoOpen, setDelayedAutoOpen] = createSignal<
    { shouldCollapse: boolean } | null
  >();
  const [userInteracted, setUserInteracted] = createSignal(false);
  createEffect(on([userInteracted], () => {
    if (userInteracted()) {
      setDelayedAutoOpen(null);
    }
  }));

  createEffect(
    on([opts.collapsible, delayedAutoOpen], () => {
      if (!opts.collapsible()) {
        setCollapsed(false);
      }
      if (
        opts.collapsible() === true /* not null */ &&
        delayedAutoOpen()?.shouldCollapse
      ) {
        setCollapsed(true);
      }
    }),
  );
  createEffect(on([opts.openable, delayedAutoOpen], () => {
    if (!opts.openable()) {
      setDisplayMode("closed");
      setUserInteracted(false);
    } else if (delayedAutoOpen()) {
      setDisplayMode("pinned");
    }
  }));

  let leaving = false;
  function handleEnter() {
    if (!opts.openable()) {
      console.warn("should not reach here!");
      return;
    }

    leaving = false;
    if (displayMode() === "closed") {
      setDisplayMode("floating");
    }
  }
  function handleLeave() {
    if (!opts.openable()) {
      console.warn("should not reach here!");
      return;
    }

    if (leaving) return;
    if (displayMode() === "floating") {
      leaving = true;
      setTimeout(() => {
        if (leaving) {
          setDisplayMode("closed");
          leaving = false;
        }
      }, LEAVING_DELAY_MS);
    }
  }

  let pinningTogglerTouched = false;
  function handleTouchPinningTogglerEnd() {
    pinningTogglerTouched = true;
    // 为防止有的浏览器 onClick 发生在 onTouchEnd 之前，
    // 这里也在一定时间后把 `pinIconTouched` 重置一下。
    setTimeout(() => pinningTogglerTouched = false, 100);
  }
  function handleTogglePinning() {
    if (!opts.openable()) {
      console.warn("should not reach here!");
      return;
    }
    setUserInteracted(true);

    setCollapsed(false);
    if (pinningTogglerTouched) {
      setDisplayMode("closed");
    } else {
      const newMode = displayMode() === "pinned" ? "floating" : "pinned";
      setDisplayMode(newMode);
    }
    pinningTogglerTouched = false;
  }

  function handleClickLabel() {
    if (!opts.openable) return;
    setUserInteracted(true);

    if (displayMode() === "pinned") {
      if (!opts.collapsible()) return;
      setCollapsed(!collapsed());
    } else {
      setCollapsed(false);
      setDisplayMode("pinned");
    }
  }

  function autoOpen(shouldCollapse: boolean) {
    setDelayedAutoOpen({ shouldCollapse });
  }

  function expand() {
    if (!opts.openable()) {
      console.warn("should not reach here!");
      return;
    }
    setUserInteracted(true);

    setCollapsed(false);
  }

  return {
    displayMode,
    collapsed: () => opts.collapsible() && collapsed(),

    enterHandler: handleEnter,
    leaveHandler: handleLeave,

    pinningTogglerTouchEndHandler: handleTouchPinningTogglerEnd,
    pinningToggleHandler: handleTogglePinning,

    labelClickHandler: handleClickLabel,

    autoOpen,

    expand,

    setDisplayMode,
  };
}

/**
 * XXX: `el` 并非 reactive，只是由于外部调用此函数时，el 可能作为 `<Show/>` 之内
 * 的 ref，不作为函数的话其值就固定了。（可能是 `on={false}` 时的 `undefined`，也
 * 可能指向先前 `on={true}` 时创建的旧元素。）
 */
function createSizeSyncer(
  elGetter: () => HTMLElement,
  opts: { enabled: Accessor<boolean> },
) {
  const [size, setSize] = createSignal<ElementSize | null>(null);

  function syncSize(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const oldSize = size();
    if (
      oldSize && oldSize.widthPx === rect.width &&
      oldSize.heightPx === rect.height
    ) {
      return;
    }
    setSize({
      widthPx: rect.width,
      heightPx: rect.height,
    });
  }
  let resizeObserverForPopper: ResizeObserver | null = null;
  createEffect(on([opts.enabled], ([enabled]) => {
    const el = elGetter();
    if (enabled) {
      syncSize(el);
      resizeObserverForPopper = new ResizeObserver(() => syncSize(el));
      resizeObserverForPopper.observe(el);
    } else {
      setSize(null);
      resizeObserverForPopper?.disconnect();
    }
  }));

  return { size };
}
