/* HACK: This is a temporary fix to suppress the hundreds of "warnings"
 * (frustratingly actually logged as errors for some reason) that React
 * emits because of us using an old version of react-bootstrap. As newer
 * versions of react-bootstrap change the components available to us, we
 * can't reasonably upgrade it until the UI code has been sufficiently
 * deduplicated to make it practical to replace these components.
 * 
 * Therefore, to retain a semblance of a usable browser console, we're
 * just going to ignore these errors for now.
 * 
 * FIXME: Actually do that react-bootstrap upgrade. It is really needed. */
let consoleError_ = console.error;
let renderSubtreeWarned = false;
console.error = function (... args) {
    if (!args[0]?.includes("ReactDOM.unstable_renderSubtreeIntoContainer() is no longer supported in React 18.")) {
    // if (!args[0]?.startsWith("Warning: ")) {
        consoleError_.call(console, ... args);
    } else if (!renderSubtreeWarned) {
        /* We do still log it once as a compact warning, to ensure that this
         * issue doesn't get overlooked in the long term. Logging it every
         * time (react-bootstrap tooltips trigger it constantly) just buries
         * the console in noise. */
        renderSubtreeWarned = true;
        console.warn(`(... ReactDOM.unstable_renderSubtreeIntoContainer() warning suppressed; further occurrences muted ...)`);
    }
}

import React from 'react'
import { createRoot } from 'react-dom/client'
import { compose, applyMiddleware, createStore } from 'redux';
import { Provider } from 'react-redux';
import { createLogger } from 'redux-logger';

import { alert } from './components/laserweb'

import persistState, {mergePersistedState} from 'redux-localstorage'
import adapter from 'redux-localstorage/lib/adapters/localStorage';
import filter from 'redux-localstorage-filter';

export const LOCALSTORAGE_KEY = 'LaserWeb';
export const DEBUG_KEY = "LaserwebDebug";

const hot = (state, action) => {
    return require('./reducers').default(state, action);
};

const reducer = compose(
    mergePersistedState((initialState, persistedState) => {
        let state = { ...initialState, ...persistedState };
        state.camera = require('./reducers/camera').resetCamera(null, state.settings);
        // Never restore an in-flight generation flag: it would leave the
        // Generate button disabled and a progress bar spinning forever.
        if (state.gcode)
            state.gcode = { ...state.gcode, gcoding: { enable: false, percent: 0 } };
        return hot(state, { type: 'LOADED' });
    })
)(hot);

const storage = compose(
  filter(['settings','machineProfiles','splitters','materialDatabase',
          'documents','operations','currentOperation','gcode'])
)(adapter(window.localStorage));

/* Documents carry parsed geometry (and bitmaps as dataURLs), so persisted
 * state can reach megabytes: write at most every 500ms instead of on every
 * dispatch, and survive a full/blocked localStorage instead of throwing on
 * each action. Big workspaces that exceed the quota simply stop persisting
 * (use the Workspace save button for those). */
let pendingPut = null;
let putTimer = null;
let quotaWarned = false;
const debouncedStorage = {
  ...storage,
  put(key, value, callback) {
    pendingPut = value;
    if (!putTimer) {
      putTimer = setTimeout(() => {
        putTimer = null;
        try {
          storage.put(key, pendingPut, (err) => {
            if (err && !quotaWarned) {
              quotaWarned = true;
              console.warn('Workspace no longer fits in localStorage; autosave disabled for this session. Use Workspace ⇒ Save.', err);
            }
          });
        } catch (err) {
          if (!quotaWarned) {
            quotaWarned = true;
            console.warn('Workspace no longer fits in localStorage; autosave disabled for this session. Use Workspace ⇒ Save.', err);
          }
        }
      }, 500);
    }
    if (callback) callback(null);
  }
};


// adds getState() to any action to get the global Store :slick:
const globalstoreMiddleWare =  store => next => action => {
  next({ ...action, getState: store.getState });
};

// Prevent drag-n-drop into main window.
window.addEventListener("dragover",function(e){
  e = e || event;
  e.preventDefault();
},false);
window.addEventListener("drop",function(e){
  e = e || event;
  e.preventDefault();
  alert("Please use the <span class='fa fa-fw fa-folder-open'></span><strong>Add Document</strong> button in the files tab to import documents into LaserWeb")
},false);


export const getDebug = () =>{
    return window.localStorage.getItem(DEBUG_KEY)==='true';
}

export const setDebug=(b) => {
    window.localStorage.setItem(DEBUG_KEY,String(b))
}

const middlewares=[];
if (getDebug()) middlewares.push(createLogger({ collapsed: true }))
middlewares.push(globalstoreMiddleWare)

const composeEnhancers = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

const middleware = composeEnhancers(
  applyMiddleware(...middlewares),
  persistState(debouncedStorage, LOCALSTORAGE_KEY),
);

const store = createStore(reducer, middleware);

// Expose the store for headless smoke tests (drive the UI through redux
// instead of fighting WebGL/canvas interaction in CI).
if (typeof window !== 'undefined') window.__store = store;

require('./lib/history-sync').initHistorySync(store);

// Bad bad bad
export function GlobalStore()
{
    return store;
}

function Hot(props) {
    const LaserWeb = require('./components/laserweb').default;
    return <LaserWeb />;
}

function renderHot() {
    const domNode = document.getElementById('laserweb');
    const root = createRoot(domNode);

    root.render((
        <Provider store={store}>
            <Hot />
        </Provider>
    ));
}
renderHot();

if (module.hot) {
    module.hot.accept('./reducers', renderHot);
    module.hot.accept('./components/laserweb', renderHot);
}
