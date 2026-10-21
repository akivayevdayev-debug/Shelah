// The community (minhag) radio group in the site settings (#minhagSetting).
// The value itself lives in state.js; this only shows and changes it.

import { getMinhag, onMinhagChange, setMinhag } from "./state.js";

export function installMinhagSetting({ doc = document } = {}) {
    const group = doc.getElementById("minhagSetting");
    if (!group) return null;
    const inputs = [...group.querySelectorAll('input[name="minhag"]')];
    if (!inputs.length) return null;

    const sync = (minhag = getMinhag()) => {
        for (const input of inputs) input.checked = input.value === minhag;
    };

    group.addEventListener("change", (event) => {
        const input = event.target;
        if (input?.name === "minhag" && input.checked) setMinhag(input.value);
    });
    const stop = onMinhagChange((minhag) => sync(minhag));
    sync();
    return { sync, stop };
}
