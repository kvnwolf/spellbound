/** The full-screen message panel: the WebGPU-required screen and the DualSense prompts. */
export const createOverlay = (element: HTMLElement) => {
  const heading = document.createElement("h1");
  const body = document.createElement("p");
  element.append(heading, body);
  let shown: string | undefined;

  return {
    hide: () => {
      element.hidden = true;
      shown = undefined;
    },
    show: (title: string, message: string) => {
      const key = `${title}\n${message}`;

      // Called every frame: only touch the DOM when the message changes.
      if (shown === key) {
        return;
      }

      shown = key;
      heading.textContent = title;
      body.textContent = message;
      element.hidden = false;
    },
  };
};
