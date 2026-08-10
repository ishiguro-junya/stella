import { describe, expect, it } from 'vitest';

import { assignHistoryLanes, type HistoryLaneNode } from './historyLanes';

function node(oid: string, parents: string[] = []): HistoryLaneNode {
  return { oid, parents };
}

describe('assignHistoryLanes', () => {
  it('keeps a linear history on one vertical lane', () => {
    const graph = assignHistoryLanes([
      node('tip', ['middle']),
      node('middle', ['root']),
      node('root'),
    ]);

    expect(graph.map((commit) => commit.lane)).toEqual([0, 0, 0]);
    expect(graph[0]).toMatchObject({
      activeLanes: [],
      nextActiveLanes: [0],
      incomingEdges: [],
      parentEdges: [{ parentOid: 'middle', fromLane: 0, toLane: 0 }],
    });
    expect(graph[1]).toMatchObject({
      activeLanes: [0],
      incomingEdges: [{ fromLane: 0, toLane: 0 }],
      parentEdges: [{ parentOid: 'root', fromLane: 0, toLane: 0 }],
    });
    expect(graph[2]).toMatchObject({
      activeLanes: [0],
      nextActiveLanes: [],
      incomingEdges: [{ fromLane: 0, toLane: 0 }],
      parentEdges: [],
    });
  });

  it('gives a forked tip its own lane and connects it diagonally to the shared base', () => {
    const graph = assignHistoryLanes([
      node('tip-a', ['base']),
      node('tip-b', ['base']),
      node('base', ['root']),
      node('root'),
    ]);

    expect(graph.map((commit) => commit.lane)).toEqual([0, 1, 0, 0]);
    expect(graph[1]).toMatchObject({
      activeLanes: [0],
      nextActiveLanes: [0],
      parentEdges: [{ parentOid: 'base', fromLane: 1, toLane: 0 }],
      laneCount: 2,
    });
  });

  it('draws both parents of a two-parent merge and keeps their lanes until convergence', () => {
    const graph = assignHistoryLanes([
      node('merge', ['left', 'right']),
      node('left', ['root']),
      node('right', ['root']),
      node('root'),
    ]);

    expect(graph.map((commit) => commit.lane)).toEqual([0, 0, 1, 0]);
    expect(graph[0]).toMatchObject({
      nextActiveLanes: [0, 1],
      parentEdges: [
        { parentOid: 'left', fromLane: 0, toLane: 0 },
        { parentOid: 'right', fromLane: 0, toLane: 1 },
      ],
      laneCount: 2,
    });
    expect(graph[2]).toMatchObject({
      activeLanes: [0, 1],
      nextActiveLanes: [0],
      incomingEdges: [{ fromLane: 1, toLane: 1 }],
      parentEdges: [{ parentOid: 'root', fromLane: 1, toLane: 0 }],
    });
  });

  it('allocates one connector for every octopus parent', () => {
    const graph = assignHistoryLanes([
      node('octopus', ['one', 'two', 'three']),
      node('one', ['root']),
      node('two', ['root']),
      node('three', ['root']),
      node('root'),
    ]);

    expect(graph[0]).toMatchObject({
      nextActiveLanes: [0, 1, 2],
      parentEdges: [
        { parentOid: 'one', fromLane: 0, toLane: 0 },
        { parentOid: 'two', fromLane: 0, toLane: 1 },
        { parentOid: 'three', fromLane: 0, toLane: 2 },
      ],
      laneCount: 3,
    });
    expect(graph.map((commit) => commit.lane)).toEqual([0, 0, 1, 2, 0]);
  });

  it('connects a side history diagonally when it converges on an active ancestor', () => {
    const graph = assignHistoryLanes([
      node('trunk-tip', ['shared']),
      node('side-tip', ['side-middle']),
      node('side-middle', ['shared']),
      node('shared'),
    ]);

    expect(graph[2]).toMatchObject({
      lane: 1,
      activeLanes: [0, 1],
      nextActiveLanes: [0],
      incomingEdges: [{ fromLane: 1, toLane: 1 }],
      parentEdges: [{ parentOid: 'shared', fromLane: 1, toLane: 0 }],
      laneCount: 2,
    });
    expect(graph[3]).toMatchObject({
      lane: 0,
      activeLanes: [0],
      incomingEdges: [{ fromLane: 0, toLane: 0 }],
    });
  });

  it('continues an edge through the bottom boundary when its parent is not loaded', () => {
    const [tip] = assignHistoryLanes([node('tip', ['not-loaded'])]);

    expect(tip).toMatchObject({
      activeLanes: [],
      nextActiveLanes: [0],
      parentEdges: [{ parentOid: 'not-loaded', fromLane: 0, toLane: 0 }],
    });
  });

  it('keeps every first-page lane and edge stable when another page is appended', () => {
    const firstPage = [node('merge', ['left', 'right']), node('left', ['root'])];
    const before = assignHistoryLanes(firstPage);
    const after = assignHistoryLanes([...firstPage, node('right', ['root']), node('root')]);

    expect(after.slice(0, firstPage.length)).toEqual(before);
    expect(firstPage).toEqual([
      { oid: 'merge', parents: ['left', 'right'] },
      { oid: 'left', parents: ['root'] },
    ]);
  });
});
