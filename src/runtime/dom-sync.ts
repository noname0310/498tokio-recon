/** Last committed DOM state. The scene writes to this mirror; DOM is not input. */
type StyleProperty = {[K in keyof CSSStyleDeclaration]-?: CSSStyleDeclaration[K] extends string ? K : never}[keyof CSSStyleDeclaration] & string;
type StylePatch = Partial<Record<StyleProperty, string | number>>;
type StyledElement = HTMLElement | SVGElement;

export class DOMSync {
  private readonly attributes = new WeakMap<Element, Map<string, string | null>>();
  private readonly styles = new WeakMap<StyledElement, Map<string, string>>();

  attribute(element: Element, name: string, value: string | number | null): void {
    const text = value === null ? null : String(value);
    let state = this.attributes.get(element);
    if (!state) this.attributes.set(element, state = new Map());
    if (state.has(name) && state.get(name) === text) return;
    state.set(name, text);
    if (text === null) element.removeAttribute(name);
    else element.setAttribute(name, text);
  }

  attrs(element: Element, values: Record<string, string | number | null>): void {
    for (const [name, value] of Object.entries(values)) this.attribute(element, name, value);
  }

  style(element: StyledElement, values: StylePatch): void {
    let state = this.styles.get(element);
    if (!state) this.styles.set(element, state = new Map());
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) continue;
      const text = String(value);
      if (state.get(name) === text) continue;
      state.set(name, text);
      element.style.setProperty(name.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase()), text);
    }
  }

  hidden(element: Element, value: boolean): void { this.attribute(element, "hidden", value ? "" : null); }
}
