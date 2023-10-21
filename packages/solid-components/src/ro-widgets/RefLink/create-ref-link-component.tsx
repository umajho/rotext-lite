import {
  Component,
  createEffect,
  createMemo,
  on,
  onCleanup,
  onMount,
} from "solid-js";

import {
  ComputedColor,
  createStyleProviderFromCSSText,
  gray500,
  mouseDownNoDoubleClickToSelect,
} from "@rotext/web-utils";

import { createRoWidgetComponent } from "../../ro-widget-core/mod";

import { HorizontalRule, PinButton } from "../support/mod";

import stylesForWidgetContent from "./WidgetContent.scss?inline";

const styleProviderForWidgetContent = createStyleProviderFromCSSText(
  stylesForWidgetContent,
);

export interface Properties {
  address: string;
}

export type RefContentRenderer = (
  el: HTMLElement,
  address: RefAddress,
  onAddressChange: (listener: (addr: RefAddress) => void) => void,
  onCleanup: (listener: () => void) => void,
) => void;

export interface CreateRefLinkComponentOptions {
  backgroundColor: ComputedColor;
  widgetOwnerClass: string;
  innerNoAutoOpenClass?: string;
  refContentRenderer: RefContentRenderer;
}

export function createRefLinkComponent(
  opts: CreateRefLinkComponentOptions,
): Component<Properties> {
  return (outerProps) => {
    const { refContentRenderer } = opts;

    const address = createMemo(() => parseAddress(outerProps.address));

    const component = createRoWidgetComponent({
      PrimeContent: (props) => {
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
      WidgetContent: (props) => {
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
          <div class="ref-link-widget-content">
            <div class="header">
              <PinButton
                displayMode={props.displayMode}
                onClick={props.handlerForClickOnPinIcon}
                onTouchEnd={props.handlerForTouchEndOnPinIcon}
              />
              <div style={{ width: "3rem" }} />
              <div>{outerProps.address}</div>
            </div>
            <HorizontalRule />
            <div ref={refContentEl} />
          </div>
        );
      },
    }, {
      widgetOwnerClass: opts.widgetOwnerClass,
      innerNoAutoOpenClass: opts.innerNoAutoOpenClass,

      widgetContentStyleProvider: styleProviderForWidgetContent,
      widgetBackgroundColor: () => opts.backgroundColor,
      maskTintColor: () => gray500,
    });

    return <>{component}</>;
  };
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
