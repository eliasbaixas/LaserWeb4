/**
 * Descriptive URLs for the sidebar panes (pushState/popstate).
 *
 * Keeps window.location.pathname in sync with the selected pane, so
 * /files, /comms, /control, /settings and /about are directly linkable
 * and the browser back/forward buttons navigate between panes.
 * @module
 */

import { selectPane } from '../actions/panes'

export const PANE_TO_PATH = {
    cam: '/files',
    com: '/comms',
    jog: '/control',
    settings: '/settings',
    about: '/about',
}

const PATH_TO_PANE = Object.fromEntries(
    Object.entries(PANE_TO_PATH).map(([pane, path]) => [path, pane]))

export function initHistorySync(store) {
    const selectedPane = () => store.getState().panes.selected
    const paneFromLocation = () => PATH_TO_PANE[window.location.pathname]

    // Guard: selectPane(current pane) would toggle the sidebar visibility,
    // so never dispatch unless the pane actually changes.
    const applyPane = (pane) => {
        if (pane && pane !== selectedPane()) store.dispatch(selectPane(pane))
    }

    // Deep link on boot: /control selects the jog pane, etc. A plain '/'
    // (or an unknown path) is normalized to the current pane's URL without
    // creating a history entry.
    applyPane(paneFromLocation())
    window.history.replaceState({ pane: selectedPane() }, '', PANE_TO_PATH[selectedPane()])

    // Back/forward: reflect the URL into the store, without pushing again.
    let navigating = false
    window.addEventListener('popstate', () => {
        navigating = true
        try {
            applyPane(paneFromLocation())
        } finally {
            navigating = false
        }
    })

    // Store -> URL: push one entry per pane change.
    let lastSelected = selectedPane()
    store.subscribe(() => {
        const selected = selectedPane()
        if (selected === lastSelected) return
        lastSelected = selected
        const path = PANE_TO_PATH[selected]
        if (!navigating && path && window.location.pathname !== path) {
            window.history.pushState({ pane: selected }, '', path)
        }
    })
}
