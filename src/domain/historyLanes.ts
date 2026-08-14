export const HISTORY_PAGE_SIZE = 100;

export interface HistoryLaneNode {
  oid: string;
  parents: readonly string[];
}

export interface HistoryIncomingEdge {
  fromLane: number;
  toLane: number;
}

export interface HistoryParentEdge {
  parentOid: string;
  fromLane: number;
  toLane: number;
}

export interface HistoryGraphTopology {
  lane: number;
  /** この行の上端で使用中のlane。 */
  activeLanes: readonly number[];
  /** この行の下端で使用中のlane。 */
  nextActiveLanes: readonly number[];
  /** 予測したCommit laneからこの行のnodeへの接続。 */
  incomingEdges: readonly HistoryIncomingEdge[];
  /** この行のnodeから宣言済みの各parentへの接続。 */
  parentEdges: readonly HistoryParentEdge[];
  /** edgeを切らずにこの行を描画するために必要な幅。 */
  laneCount: number;
}

export type HistoryGraphNode<Node extends HistoryLaneNode> = Node & HistoryGraphTopology;

function occupiedLanes(active: readonly (string | undefined)[]): number[] {
  return active.flatMap((oid, lane) => (oid === undefined ? [] : [lane]));
}

/**
 * Git logの出力を新しい順に辿りながら、安定したgraph layoutを構築する。
 * 各行は上にある行だけに依存するため、次のpageを追加しても描画済みのlaneやedgeは変わらない。
 */
export function assignHistoryLanes<Node extends HistoryLaneNode>(
  commits: readonly Node[],
): Array<HistoryGraphNode<Node>> {
  const active: Array<string | undefined> = [];

  const availableLane = (after = -1): number => {
    const later = active.findIndex((oid, index) => index > after && oid === undefined);
    if (later >= 0) return later;
    const earlier = active.findIndex((oid) => oid === undefined);
    if (earlier >= 0) return earlier;
    return active.length;
  };

  return commits.map((commit) => {
    const activeBefore = [...active];
    const matchingLanes = occupiedLanes(activeBefore).filter(
      (lane) => activeBefore[lane] === commit.oid,
    );
    const lane = matchingLanes[0] ?? availableLane();
    if (matchingLanes.length === 0) active[lane] = commit.oid;

    for (const duplicateLane of matchingLanes.slice(1)) active[duplicateLane] = undefined;

    const incomingEdges = matchingLanes.map((fromLane) => ({ fromLane, toLane: lane }));
    const parentEdges: HistoryParentEdge[] = [];
    const [firstParent, ...mergeParents] = [...new Set(commit.parents)];

    if (!firstParent) {
      active[lane] = undefined;
    } else {
      // 共通の親でもこのlaneを親行まで保ち、分岐元から斜め線を開始する。
      active[lane] = firstParent;
      parentEdges.push({ parentOid: firstParent, fromLane: lane, toLane: lane });
    }

    for (const parentOid of mergeParents) {
      let parentLane = active.indexOf(parentOid);
      if (parentLane < 0) {
        parentLane = availableLane(lane);
        active[parentLane] = parentOid;
      }
      parentEdges.push({ parentOid, fromLane: lane, toLane: parentLane });
    }

    while (active.length > 0 && active.at(-1) === undefined) active.pop();

    const activeLanes = occupiedLanes(activeBefore);
    const nextActiveLanes = occupiedLanes(active);
    const edgeLanes = [...incomingEdges, ...parentEdges].flatMap((edge) => [
      edge.fromLane,
      edge.toLane,
    ]);
    const laneCount = Math.max(
      1,
      lane + 1,
      ...activeLanes.map((activeLane) => activeLane + 1),
      ...nextActiveLanes.map((activeLane) => activeLane + 1),
      ...edgeLanes.map((edgeLane) => edgeLane + 1),
    );

    return {
      ...commit,
      lane,
      activeLanes,
      nextActiveLanes,
      incomingEdges,
      parentEdges,
      laneCount,
    };
  });
}
