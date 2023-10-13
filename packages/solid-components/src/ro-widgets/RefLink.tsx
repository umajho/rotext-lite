import styles from "./RefLink.module.scss";

import {
  Component,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { customElement } from "solid-element";

import {
  getComputedColor,
  getComputedCSSValueOfClass,
  gray500,
  mouseDownNoDoubleClickToSelect,
} from "@rotext/web-utils";

import { createRoWidgetComponent } from "../ro-widget-core/mod";

import { PinButton, WidgetContainer } from "./support";

const BACKGROUND_COLOR = getComputedColor(
  getComputedCSSValueOfClass("background-color", "tuan-background"),
)!;

interface Properties {
  address: string;
}

export type RefContentRenderer = (
  el: HTMLElement,
  address: RefAddress,
  onAddressChange: (listener: (addr: RefAddress) => void) => void,
  onCleanup: (listener: () => void) => void,
) => void;

interface CreateRefLinkComponentOptions {
  widgetOwnerClass: string;
  innerNoAutoOpenClass: string;
  refContentRenderer: RefContentRenderer;
}

function createRefLinkComponent(
  opts: CreateRefLinkComponentOptions,
): Component<Properties> {
  return (outerProps) => {
    const { refContentRenderer } = opts;

    const address = createMemo(() => parseAddress(outerProps.address));

    const component = createRoWidgetComponent({
      primeContentComponent: (props) => {
        return (
          <span
            style={{ cursor: props.cursor }}
            onClick={props.onToggleWidget}
            onMouseDown={mouseDownNoDoubleClickToSelect}
          >
            {`>>${outerProps.address}`}
          </span>
        );
      },
      widgetContainerComponent: WidgetContainer,
      widgetContentComponent: (props) => {
        let refContentEl!: HTMLDivElement;

        onMount(() => {
          const changeListeners: ((addr: RefAddress) => void)[] = [];
          const cleanupListeners: (() => void)[] = [];
          refContentRenderer(
            refContentEl,
            address(),
            (listener) => changeListeners.push(listener),
            (listener) => cleanupListeners.push(listener),
          );
          createEffect(on(
            [address],
            () => changeListeners.forEach((listener) => listener(address())),
            { defer: true },
          ));
          onCleanup(() => cleanupListeners.forEach((listener) => listener()));
        });

        return (
          <div class={styles["ref-link-widget-content"]}>
            <div class={styles["header"]}>
              <PinButton
                displayMode={props.displayMode}
                onClick={props.onClickOnPinIcon}
                onTouchEnd={props.onTouchEndOnPinIcon}
              />
              <div style={{ width: "3rem" }} />
              <div>{outerProps.address}</div>
            </div>
            <hr />
            <div style={{ padding: "1rem" }}>
              <div ref={refContentEl} />
            </div>
          </div>
        );
      },
    }, {
      widgetOwnerClass: opts.widgetOwnerClass,
      innerNoAutoOpenClass: opts.innerNoAutoOpenClass,
      widgetBackgroundColor: () => BACKGROUND_COLOR,
      maskTintColor: () => gray500,
    });

    return <>{component}</>;
  };
}

export function registerCustomElement(
  tag: string,
  opts: CreateRefLinkComponentOptions,
) {
  customElement(tag, { address: "" }, createRefLinkComponent(opts));
}

function parseAddress(address: string): RefAddress {
  const prefixAndContent = /^([A-Z]+)\.(.*)$/.exec(address);
  if (!prefixAndContent) return { type: "unknown" };
  const [_1, prefix, content] = //
    prefixAndContent as unknown as [string, string, string];

  if (/^\d+$/.test(content)) {
    const postNumber = parseInt(content);
    return { type: "post_number", prefix, postNumber };
  }

  const threadIDAndRest = /^([a-z]+)(?:\.([a-z]+))?(?:#(\d+))?$/.exec(content);
  if (!threadIDAndRest) return { type: "unknown" };
  const [_2, threadID, subThreadID, floorNumberText] = //
    threadIDAndRest as unknown as [string, string, string?, string?];

  return {
    prefix,
    threadID,
    ...(floorNumberText ? { floorNumber: parseInt(floorNumberText) } : {}),
    ...(subThreadID
      ? {
        type: "thread_id_sub",
        subThreadID,
      }
      : {
        type: "thread_id",
      }),
  };
}

export type RefAddress =
  | (
    & { prefix: string }
    & (
      | { type: "post_number"; postNumber: number }
      | { type: "thread_id"; threadID: string; floorNumber?: number }
      | {
        type: "thread_id_sub";
        threadID: string;
        subThreadID: string;
        floorNumber?: number;
      }
    )
  )
  | { type: "unknown" };