import { Children, isValidElement, type ReactNode } from "react";

import RootLayout from "@/app/layout";
import { AppLifecycleHeartbeat } from "@/components/app-lifecycle-heartbeat";

describe("RootLayout", () => {
  it("suppresses hydration warnings on the html element for extension-injected attributes", () => {
    const tree = RootLayout({
      children: <div>demo</div>,
    });

    expect(isValidElement(tree)).toBe(true);
    expect(tree.type).toBe("html");
    expect(tree.props.lang).toBe("zh-CN");
    expect(tree.props.suppressHydrationWarning).toBe(true);
  });

  it("keeps the local service informed while any app page is open", () => {
    const tree = RootLayout({
      children: <div>demo</div>,
    });
    const body = Children.toArray(tree.props.children).find(
      (child) => isValidElement(child) && child.type === "body",
    );

    expect(isValidElement(body)).toBe(true);

    if (!isValidElement<{ children: ReactNode }>(body)) {
      throw new Error("未找到页面 body");
    }

    expect(
      Children.toArray(body.props.children).some(
        (child) => isValidElement(child) && child.type === AppLifecycleHeartbeat,
      ),
    ).toBe(true);
  });
});
