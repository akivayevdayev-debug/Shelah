/**
 * The `dataset` of a hand-made element: a camelCase view (`el.dataset.notFound`)
 * of its `data-not-found` attribute, over whatever store the fake keeps its
 * attributes in. A real element maps the two names the same way.
 */
'use strict';

function attributeName(prop) {
    return `data-${prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/** @param {{get: (name: string) => string|undefined|null, set: (name: string, value: string) => void, remove: (name: string) => void}} store */
function fakeDataset(store) {
    return new Proxy({}, {
        get: (_, prop) => (typeof prop === 'string' ? store.get(attributeName(prop)) ?? undefined : undefined),
        set: (_, prop, value) => {
            store.set(attributeName(prop), String(value));
            return true;
        },
        deleteProperty: (_, prop) => {
            store.remove(attributeName(prop));
            return true;
        },
    });
}

module.exports = { fakeDataset };
