/**
 * The DualSense's face buttons drawn as their own symbols, thin strokes in
 * the text's colour, in place of the ✕ ○ □ △ characters, which fonts draw
 * unevenly. `writeWithIcons` fills an element with a line of text, each of
 * those characters swapped for its icon.
 */
import { text } from "./text";

export type FaceButton = "circle" | "cross" | "square" | "triangle";

const svgNamespace = "http://www.w3.org/2000/svg";

/** Each symbol's strokes on a 24-unit square. */
const strokes: Record<FaceButton, readonly [string, Record<string, string>]> = {
  circle: ["circle", { cx: "12", cy: "12", r: "7.6" }],
  cross: ["path", { d: "M5.6 5.6 18.4 18.4M18.4 5.6 5.6 18.4" }],
  square: ["rect", { height: "14", width: "14", x: "5", y: "5" }],
  triangle: ["path", { d: "M12 4.4 20.6 19.2H3.4Z" }],
};

const characters: ReadonlyMap<string, FaceButton> = new Map([
  ["○", "circle"],
  ["✕", "cross"],
  ["□", "square"],
  ["△", "triangle"],
]);

export const buttonIcon = (button: FaceButton): SVGSVGElement => {
  const svg = document.createElementNS(svgNamespace, "svg");
  const [tag, attributes] = strokes[button];
  const stroke = document.createElementNS(svgNamespace, tag);

  for (const [name, value] of Object.entries(attributes)) {
    stroke.setAttribute(name, value);
  }

  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "1.1em");
  svg.setAttribute("height", "1.1em");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", text.buttons[button]);
  svg.style.verticalAlign = "-0.2em";
  svg.append(stroke);

  return svg;
};

/** Fills `element` with `line`, its face button characters drawn as icons. */
export const writeWithIcons = (element: Element, line: string) => {
  element.replaceChildren(
    ...line.split(/(?<button>[○✕□△])/u).flatMap((part): (Node | string)[] => {
      const button = characters.get(part);

      if (button) {
        return [buttonIcon(button)];
      }

      return part === "" ? [] : [part];
    })
  );
};
