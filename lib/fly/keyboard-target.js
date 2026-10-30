/** Let native controls, text editing, IME and browser shortcuts own their keys. */
export function editableTarget(target) {
  return target?.isContentEditable === true ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '') ||
    !!target?.closest?.('[role="textbox"], [role="combobox"], [contenteditable="true"]');
}

export function keyboardTarget(target) {
  return editableTarget(target) || /^(BUTTON|A)$/.test(target?.tagName ?? '') ||
    !!target?.closest?.('button, a[href], [role="button"]');
}

export function reservedKeyEvent(event) {
  return event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey;
}
