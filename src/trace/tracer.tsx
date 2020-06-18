import type { _h, api } from 'sinuous/h';
import type { El, ComponentName } from './index.js';

import { ds, callLifecycleForTree } from './index.js';
import { type } from './utils.js';

const refDF: DocumentFragment[] = [];

const hTracer = (hCall: typeof _h.h): typeof _h.h =>
  // @ts-ignore DocumentFragment is not assignable to SVGElement | HTMLElement
  (...args: unknown[]) => {
    const [fn] = args;
    if (typeof fn !== 'function') {
      // @ts-ignore TS doesn't understand ...args
      const retH = hCall(...args);
      if (retH instanceof DocumentFragment) refDF.push(retH);
      return retH;
    }

    const name = fn.name as ComponentName;
    console.group(`🔶 ${name}`);

    const renderData = { lifecycles: {}, hydrations: {} };
    ds.stack.push(renderData);
    // @ts-ignore TS bug? Destructs overload as `&` not `|`
    const el: HTMLElement | SVGElement | DocumentFragment = hCall(...args);
    ds.stack.pop();

    // Not Element or DocumentFragment
    if (!(el instanceof Node)) {
      console.log(`${name}: Function but not component ❌`);
      console.groupEnd();
      return el;
    }

    // Elements become components _after_ all children are added, so they
    // will be guardians by now if they had children. Guard->Component
    const elGuard = ds.guardMeta.get(el);
    const children = elGuard?.children ?? new Set<El>();
    if (elGuard) ds.guardMeta.delete(el);

    // Register as a component
    ds.compMeta.set(el, { name, children, ...renderData });

    // Provide visual in DevTools
    const DATASET_TAG = 'component';
    if (el instanceof Element) el.dataset[DATASET_TAG] = name;
    else el.childNodes.forEach(x => { (x as HTMLElement).dataset[DATASET_TAG] = name })

    console.log(`${name}: Done. Render data:`, renderData);
    console.groupEnd();
    return el;
  };

// In Sinuous, api.add is not purely a sub-function of api.h. It will call api.h
// if given an array and then converts it to a fragment internally so we never
// see the fragment. That's why hTracer sets refDF to be used here. It will be
// empty (parent.insertBefore clears childNodes) but the object ref is OK
const addTracer = (addCall: typeof api.add): typeof api.add =>
  (parent: El, value: El, endMark) => {
    console.group('api.add()');
    console.log(`parent:${type(parent)}, value:${type(value)}`);

    // Save this value before addCall()
    const valueWasNotPreviouslyConnected = !value.isConnected;
    const retAdd = addCall(parent, value, endMark);

    // @ts-ignore TS bug? Undefined after checking length
    if (Array.isArray(value) && refDF.length) value = refDF.pop();
    if (!(value instanceof Element || value instanceof DocumentFragment)) {
      console.groupEnd();
      return retAdd;
    }

    const maybeAttach = (): void => {
      if (parent.isConnected && valueWasNotPreviouslyConnected)
        callLifecycleForTree('onAttach', value);
    };

    // TODO: This could replace all the if/else below? (c: El | Set<El>) =>
    const walkUpToPlaceChildren = (children: Set<El>) => {
      let cursor: El | null = parent;
      // eslint-disable-next-line no-cond-assign
      while (cursor = cursor.parentElement) {
        console.log('Trying', type(cursor));
        const container = ds.compMeta.get(cursor) ?? ds.guardMeta.get(cursor);
        if (container) {
          console.log(`Found ${type(cursor)}`);
          // If (children instanceof Set) || container.children.add(children);
          children.forEach(x => container.children.add(x));
          break;
        }
        // Didn't find a component or guard walking up tree. Default to <body/>
        if (cursor === document.body) {
          ds.guardMeta.set(parent, { children });
          break;
        }
      }
    };

    const parentCompOrGuard = ds.compMeta.get(parent) ?? ds.guardMeta.get(parent);
    // If comp(or guard)<-el, no action
    // If comp(or guard)<-comp, parent also guards val
    // If comp(or guard)<-guard, parent also guards val's children and val is no longer a guard
    // If el<-el, no action
    // If el<-comp, parent is now a guard of val
    // If el<-guard, parent is now a guard of val's children and val is no longer a guard

    const valueCompMeta = ds.compMeta.get(value);
    const valueGuardMeta = ds.guardMeta.get(value);
    // No action case:
    if (!valueCompMeta && !valueGuardMeta) {
      maybeAttach();
      console.groupEnd();
      return retAdd;
    }

    if (parentCompOrGuard) {
      if (valueCompMeta)
        parentCompOrGuard.children.add(value);
      else if (valueGuardMeta)
        valueGuardMeta.children.forEach(x => parentCompOrGuard.children.add(x));
    } else {
      const children = valueGuardMeta?.children ?? new Set([value]);
      if (!parent.parentElement || parent === document.body)
        ds.guardMeta.set(parent, { children });
      else
        // Being add()'d into a connected tree. Look for a comp/guard parent
        walkUpToPlaceChildren(children);
    }
    maybeAttach();
    // Delete _after_ attaching
    if (valueGuardMeta) ds.guardMeta.delete(value);
    console.groupEnd();
    return retAdd;
  };

const insertTracer = (insertCall: typeof api.insert): typeof api.insert =>
  (el, value, endMark, current, startNode) => {
    console.group('api.insert()');
    console.log(`el:${type(el)}, value:${type(value)}, current:${type(current)}`);
    const retInsert = insertCall(el, value, endMark, current, startNode);
    console.groupEnd();
    return retInsert;
  };

const rmTracer = (rmCall: typeof api.rm): typeof api.rm =>
  (parent, start: ChildNode, end) => {
    console.group('api.rm()')
    if (parent.isConnected) {
      for (let c: ChildNode | null = start; c && c !== end; c = c.nextSibling)
        callLifecycleForTree('onDetach', c);
    }
    const retRm = rmCall(parent, start, end);
    console.groupEnd();
    return retRm;
  }

export { hTracer, addTracer, insertTracer, rmTracer };
