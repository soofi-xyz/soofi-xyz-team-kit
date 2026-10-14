import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Code,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  computeDAGLayout,
  useCanvasState,
  useHostTheme,
  useMemo,
} from "cursor/canvas";

// Model release canvas template. Mapping rules: model-visualization.md (same folder).
// Copy this file, replace only the block between DATA START and DATA END, and keep
// every value inline: canvases cannot fetch, and no credential may appear here.

type SourceKind = "governed-release" | "repository-checkout" | "sample";
type Release = {
  title: string;
  vocabularyId: string;
  packageKind: "base" | "extension";
  namespace: string;
  releaseId: string;
  releaseDigest: string;
  sourceDigest?: string;
  source: SourceKind;
  sourceDetail: string;
  readAt: string;
};
type Prop = { name: string; type?: string; required?: boolean; enumValues?: string[] };
type Vertex = { id: string; name: string; imported?: boolean; props: Prop[] };
type Edge = { id: string; from: string; to: string; props: Prop[] };
type Metric = {
  id: string;
  name: string;
  root: string;
  family?: string;
  edges: string[];
  measure: string;
  unique?: string;
  dimensions: string[];
  conditions: string[];
  businessTime?: string;
  timezone?: string;
  scopes: string[];
  grains: string[];
  cohort?: string[];
  rule?: string;
};
type Ratio = { id: string; question: string; numerator: string; denominator: string };
type Catalog = {
  catalogId: string;
  origin: "local" | "inherited";
  sourcePackageNamespace?: string;
  contractVersion: string;
  digest: string;
  metrics: Metric[];
  ratios: Ratio[];
};

const p = (name: string, required = false, enumValues?: string[], type?: string): Prop => ({
  name,
  required,
  enumValues,
  type,
});

// ===== DATA START =====
const RELEASE: Release = {
  title: "Sample extension model and metrics",
  vocabularyId: "sample-extension",
  packageKind: "extension",
  namespace: "https://schemas.example.test/sample-extension",
  releaseId: "rel-sample0001",
  releaseDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000001",
  sourceDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000002",
  source: "sample",
  sourceDetail: "Synthetic sample data shipped with the template",
  readAt: "2026-01-01",
};

const VERTICES: Vertex[] = [
  { id: "customer", name: "Customer", imported: true, props: [p("customer_identifier", true), p("created_at", false, undefined, "date-time")] },
  { id: "order", name: "Order", props: [p("order_identifier", true), p("channel", false, ["ONLINE", "IN_PERSON", "PHONE"]), p("created_at", false, undefined, "date-time")] },
  { id: "shipment", name: "Shipment", props: [p("shipment_identifier", true), p("carrier")] },
];

const EDGES: Edge[] = [
  { id: "customer_has_order", from: "customer", to: "order", props: [p("created_at", true)] },
  { id: "order_has_shipment", from: "order", to: "shipment", props: [p("created_at", true)] },
  {
    id: "order_status_changed",
    from: "order",
    to: "order",
    props: [
      p("status", true, ["DRAFT", "PLACED", "CONFIRMED", "PICKED", "PACKED", "SHIPPED", "DELIVERED", "FULFILLED", "CANCELLED", "RETURNED"]),
      p("effective_at", true, undefined, "date-time"),
    ],
  },
];

const PLACED = ["PLACED"];

const CATALOGS: Catalog[] = [
  {
    catalogId: "sample-base-metrics",
    origin: "inherited",
    sourcePackageNamespace: "https://schemas.example.test/sample-base",
    contractVersion: "model-metric-catalog/v1",
    digest: "sha256:0000000000000000000000000000000000000000000000000000000000000003",
    metrics: [
      {
        id: "customer.created.count",
        name: "Customers created",
        root: "customer",
        edges: [],
        measure: "COUNT vertex:customer",
        unique: "customer.customer_identifier",
        dimensions: [],
        conditions: [],
        businessTime: "customer.created_at",
        timezone: "UTC",
        scopes: ["GLOBAL"],
        grains: ["DAY", "MONTH"],
        rule: "Each customer counts once at its creation time.",
      },
    ],
    ratios: [],
  },
  {
    catalogId: "sample-order-metrics",
    origin: "local",
    contractVersion: "model-metric-catalog/v1",
    digest: "sha256:0000000000000000000000000000000000000000000000000000000000000004",
    metrics: [
      {
        id: "order.status.placed.count",
        name: "Orders placed",
        root: "order",
        family: "sample.property.edge.order_status_changed.status",
        edges: ["order_status_changed"],
        measure: "COUNT vertex:order",
        unique: "order.order_identifier",
        dimensions: ["status"],
        conditions: ["order_status_changed.status = PLACED"],
        businessTime: "order_status_changed.effective_at",
        timezone: "UTC",
        scopes: ["GLOBAL"],
        grains: ["DAY", "MONTH"],
        cohort: PLACED,
        rule: "Each order counts once, at its earliest PLACED status change.",
      },
      {
        id: "order.status.fulfilled.count",
        name: "Placed orders fulfilled",
        root: "order",
        family: "sample.property.edge.order_status_changed.status",
        edges: ["order_status_changed"],
        measure: "COUNT vertex:order",
        unique: "order.order_identifier",
        dimensions: ["status"],
        conditions: ["order_status_changed.status = PLACED", "order_status_changed.status = FULFILLED"],
        businessTime: "order_status_changed.effective_at",
        timezone: "UTC",
        scopes: ["GLOBAL"],
        grains: ["DAY", "MONTH"],
        cohort: PLACED,
        rule: "Same PLACED cohort and time as orders placed; counts orders that ever reached FULFILLED.",
      },
    ],
    ratios: [
      {
        id: "order.fulfillment.rate",
        question: "Share of placed orders that are fulfilled",
        numerator: "order.status.fulfilled.count",
        denominator: "order.status.placed.count",
      },
    ],
  },
];
// ===== DATA END =====

const NODE_W = 160;
const NODE_H = 46;
const ENUM_LIMIT = 8;
const NAME_LIMIT = 21;

type PlacedMetric = Metric & { catalogId: string; origin: Catalog["origin"] };
type PlacedRatio = Ratio & { catalogId: string };

const vertexIds = new Set(VERTICES.map((v) => v.id));
const knownEdges = EDGES.filter((e) => vertexIds.has(e.from) && vertexIds.has(e.to));
const crossEdges = knownEdges.filter((e) => e.from !== e.to);
const eventCount = knownEdges.length - crossEdges.length;
const eventEdges = (vertexId: string) => knownEdges.filter((e) => e.from === vertexId && e.to === vertexId);
const METRICS: PlacedMetric[] = CATALOGS.flatMap((c) =>
  c.metrics.map((m) => ({ ...m, catalogId: c.catalogId, origin: c.origin })),
);
const RATIOS: PlacedRatio[] = CATALOGS.flatMap((c) => c.ratios.map((r) => ({ ...r, catalogId: c.catalogId })));
const metricsFor = (vertexId: string) => METRICS.filter((m) => m.root === vertexId);
const metricName = (id: string) => METRICS.find((m) => m.id === id)?.name ?? id;
const DEFAULT_VERTEX =
  [...VERTICES].sort((a, b) => metricsFor(b.id).length - metricsFor(a.id).length)[0]?.id ?? "";

const clip = (value: string, limit: number) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value);
const shortDigest = (digest: string) => {
  const [algorithm, hex] = digest.includes(":") ? digest.split(":", 2) : ["", digest];
  const body = hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-5)}` : hex;
  return algorithm ? `${algorithm}:${body}` : body;
};

function readsOf(metric: PlacedMetric | undefined) {
  const reads = new Map<string, Set<string>>();
  if (!metric) return reads;
  const text = [...metric.conditions, metric.unique ?? "", metric.businessTime ?? ""].join(" ");
  for (const match of text.matchAll(/\b([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\b/g)) {
    const [, owner, prop] = match;
    if (!reads.has(owner)) reads.set(owner, new Set());
    reads.get(owner)!.add(prop);
  }
  return reads;
}

function EnumPills({ values }: { values: string[] }) {
  const shown = values.slice(0, ENUM_LIMIT);
  const rest = values.length - shown.length;
  return (
    <Row gap={4} wrap>
      {shown.map((v) => (
        <Pill key={v} size="sm">
          {v}
        </Pill>
      ))}
      {rest > 0 && (
        <Pill size="sm" title={values.slice(ENUM_LIMIT).join(", ")}>
          {`+${rest} more`}
        </Pill>
      )}
    </Row>
  );
}

function PropTable({ props, highlight }: { props: Prop[]; highlight: Set<string> }) {
  const typed = props.some((pr) => pr.type);
  return (
    <Table
      headers={typed ? ["Property", "Type", "Required", "Allowed values"] : ["Property", "Required", "Allowed values"]}
      rowTone={props.map((pr) => (highlight.has(pr.name) ? "info" : undefined))}
      rows={props.map((pr) => [
        <Code key="n">{pr.name}</Code>,
        ...(typed ? [pr.type ?? ""] : []),
        pr.required ? "yes" : "",
        pr.enumValues && pr.enumValues.length > 0 ? (
          <EnumPills key="e" values={pr.enumValues} />
        ) : (
          <Text key="t" size="small" tone="quaternary">
            any
          </Text>
        ),
      ])}
    />
  );
}

function ModelGraph({
  selected,
  focusEdges,
  onSelect,
}: {
  selected: string;
  focusEdges: Set<string>;
  onSelect: (id: string) => void;
}) {
  const theme = useHostTheme();
  const layout = useMemo(() => {
    const pairs = new Map<string, { from: string; to: string }>();
    for (const e of crossEdges) {
      const key = `${e.from}>${e.to}`;
      if (!pairs.has(key)) pairs.set(key, { from: e.from, to: e.to });
    }
    return computeDAGLayout({
      nodes: VERTICES.map((v) => ({ id: v.id })),
      edges: [...pairs.values()],
      direction: "vertical",
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
      rankGap: 70,
      nodeGap: 36,
      padding: 16,
    });
  }, []);
  const vertexById = new Map(VERTICES.map((v) => [v.id, v]));
  const focusRoots = new Set(knownEdges.filter((e) => focusEdges.has(e.id)).map((e) => e.from));
  const wide = layout.width > 760;

  return (
    <div style={{ overflow: "auto", maxHeight: 600 }}>
      <svg
        width={wide ? layout.width : "100%"}
        height={wide ? layout.height : undefined}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ display: "block" }}
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.stroke.primary} />
          </marker>
          <marker id="arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={theme.accent.primary} />
          </marker>
        </defs>
        {layout.edges.map((e) => {
          const touches = e.from === selected || e.to === selected;
          const midY = (e.sourceY + e.targetY) / 2;
          const d = e.isBackEdge
            ? `M ${e.sourceX + 24} ${e.sourceY - NODE_H} C ${e.sourceX + 90} ${e.sourceY - NODE_H - 40}, ${e.targetX + 90} ${e.targetY + 40}, ${e.targetX + 24} ${e.targetY}`
            : `M ${e.sourceX} ${e.sourceY} C ${e.sourceX} ${midY}, ${e.targetX} ${midY}, ${e.targetX} ${e.targetY}`;
          return (
            <path
              key={`${e.from}>${e.to}`}
              d={d}
              fill="none"
              stroke={touches ? theme.accent.primary : theme.stroke.primary}
              strokeWidth={touches ? 1.6 : 1}
              strokeDasharray={e.isBackEdge ? "4 3" : undefined}
              markerEnd={touches ? "url(#arrow-accent)" : "url(#arrow)"}
            />
          );
        })}
        {layout.nodes.map((n) => {
          const v = vertexById.get(n.id)!;
          const isSelected = n.id === selected;
          const metricCount = metricsFor(n.id).length;
          const events = eventEdges(n.id).length;
          return (
            <g key={n.id} onClick={() => onSelect(n.id)} style={{ cursor: "pointer" }}>
              <title>{`${v.name} (${v.id})`}</title>
              <rect
                x={n.x}
                y={n.y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={isSelected ? theme.fill.secondary : theme.bg.elevated}
                stroke={isSelected || focusRoots.has(n.id) ? theme.accent.primary : theme.stroke.secondary}
                strokeWidth={isSelected ? 1.8 : 1}
                strokeDasharray={v.imported ? "4 3" : undefined}
              />
              <text x={n.x + 10} y={n.y + 19} fontSize={12} fontWeight={600} fill={theme.text.primary}>
                {clip(v.name, metricCount > 0 ? NAME_LIMIT - 3 : NAME_LIMIT)}
              </text>
              <text x={n.x + 10} y={n.y + 35} fontSize={10} fill={theme.text.tertiary}>
                {`${v.props.length} props${events > 0 ? ` · ${events} events` : ""}${v.imported ? " · imported" : ""}`}
              </text>
              {metricCount > 0 && (
                <g>
                  <rect x={n.x + NODE_W - 30} y={n.y + 8} width={22} height={16} rx={8} fill={theme.accent.primary} />
                  <text x={n.x + NODE_W - 19} y={n.y + 20} fontSize={10} fontWeight={600} textAnchor="middle" fill={theme.text.onAccent}>
                    {metricCount}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function VertexPanel({ vertexId, focusMetric }: { vertexId: string; focusMetric?: PlacedMetric }) {
  const theme = useHostTheme();
  const vertex = VERTICES.find((v) => v.id === vertexId);
  if (!vertex) return null;
  const events = eventEdges(vertexId);
  const outgoing = crossEdges.filter((e) => e.from === vertexId);
  const incoming = crossEdges.filter((e) => e.to === vertexId);
  const reads = readsOf(focusMetric && focusMetric.root === vertexId ? focusMetric : undefined);
  const propList = (props: Prop[]) => (props.length > 0 ? props.map((x) => x.name).join(", ") : "none");

  return (
    <Stack gap={14}>
      <Stack gap={2}>
        <H3>{vertex.name}</H3>
        <Text size="small" tone="tertiary">
          <Code>{vertex.id}</Code>
          {vertex.imported ? " · imported from the base package" : ""} · {outgoing.length} outgoing · {incoming.length} incoming
          {events.length > 0 ? ` · ${events.length} event types` : ""}
        </Text>
      </Stack>
      {vertex.props.length > 0 && <PropTable props={vertex.props} highlight={reads.get(vertexId) ?? new Set()} />}
      {events.length > 0 && (
        <Stack gap={8}>
          <Text size="small" weight="semibold" tone="secondary">
            Events recorded on this vertex
          </Text>
          {events.map((e) => {
            const used = focusMetric?.edges.includes(e.id) ?? false;
            return (
              <div
                key={e.id}
                style={{
                  padding: 10,
                  borderRadius: 6,
                  border: `1px solid ${used ? theme.accent.primary : theme.stroke.tertiary}`,
                }}
              >
                <Stack gap={8}>
                  <Row gap={8} align="center">
                    <Code>{e.id}</Code>
                    {used && (
                      <Text size="small" tone="secondary">
                        used by selected metric
                      </Text>
                    )}
                  </Row>
                  {e.props.length > 0 && <PropTable props={e.props} highlight={reads.get(e.id) ?? new Set()} />}
                </Stack>
              </div>
            );
          })}
        </Stack>
      )}
      {(outgoing.length > 0 || incoming.length > 0) && (
        <Stack gap={6}>
          <Text size="small" weight="semibold" tone="secondary">
            Relationships
          </Text>
          <Table
            headers={["Relationship", "Direction", "Properties"]}
            rows={[
              ...outgoing.map((e) => [<Code key="r">{e.id}</Code>, `→ ${e.to}`, propList(e.props)]),
              ...incoming.map((e) => [<Code key="r">{e.id}</Code>, `← ${e.from}`, propList(e.props)]),
            ]}
          />
        </Stack>
      )}
    </Stack>
  );
}

function MetricCard({ metric, active, onSelect }: { metric: PlacedMetric; active: boolean; onSelect: () => void }) {
  const theme = useHostTheme();
  const details: Array<[string, string]> = [
    ["Measure", metric.measure],
    ...(metric.unique ? [["Counted once per", metric.unique] as [string, string]] : []),
    ...(metric.businessTime ? [["Business time", metric.businessTime] as [string, string]] : []),
    ...(metric.dimensions.length > 0 ? [["Dimensions", metric.dimensions.join(", ")] as [string, string]] : []),
    ...(metric.family ? [["Family", metric.family] as [string, string]] : []),
    ["Catalog", `${metric.catalogId} (${metric.origin})`],
  ];
  const scope = [metric.scopes.join(", "), metric.grains.join(", "), metric.timezone ?? ""].filter(Boolean).join(" · ");
  return (
    <div
      role="button"
      onClick={onSelect}
      style={{
        cursor: "pointer",
        padding: 12,
        borderRadius: 6,
        border: `1px solid ${active ? theme.accent.primary : theme.stroke.tertiary}`,
        background: active ? theme.fill.quaternary : "transparent",
      }}
    >
      <Stack gap={8}>
        <Row gap={8} align="center" justify="space-between">
          <Stack gap={2}>
            <Text weight="semibold">{metric.name}</Text>
            <Text size="small" tone="tertiary">
              <Code>{metric.id}</Code>
            </Text>
          </Stack>
          {metric.origin === "inherited" && <Pill size="sm">inherited</Pill>}
        </Row>
        {metric.rule && <Text size="small">{metric.rule}</Text>}
        {active && (
          <Stack gap={8}>
            <Divider />
            <Grid columns="minmax(0, 120px) minmax(0, 1fr)" gap={6}>
              {details.map(([label, value]) => [
                <Text key={`${label}-l`} size="small" tone="secondary">
                  {label}
                </Text>,
                <Code key={`${label}-v`}>{value}</Code>,
              ])}
              {scope && (
                <Text size="small" tone="secondary">
                  Scope / grains
                </Text>
              )}
              {scope && <Text size="small">{scope}</Text>}
            </Grid>
            {metric.conditions.length > 0 && (
              <Stack gap={4}>
                <Text size="small" tone="secondary">
                  Filters (all must match)
                </Text>
                {metric.conditions.map((c) => (
                  <Code key={c}>{c}</Code>
                ))}
              </Stack>
            )}
            {metric.cohort && metric.cohort.length > 0 && (
              <Stack gap={4}>
                <Text size="small" tone="secondary">
                  Cohort values
                </Text>
                <EnumPills values={metric.cohort} />
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
    </div>
  );
}

export default function ModelReleaseCanvas() {
  const theme = useHostTheme();
  const [storedVertex, setSelected] = useCanvasState<string>("vertex", DEFAULT_VERTEX);
  const [metricId, setMetricId] = useCanvasState<string>("metric", "");
  const selected = vertexIds.has(storedVertex) ? storedVertex : DEFAULT_VERTEX;
  const rootMetrics = metricsFor(selected);
  const focusMetric = rootMetrics.find((m) => m.id === metricId) ?? rootMetrics[0];
  const focusEdges = new Set(focusMetric?.edges ?? []);
  const vertexRatios = RATIOS.filter((r) => rootMetrics.some((m) => m.id === r.numerator || m.id === r.denominator));
  const selectedName = VERTICES.find((v) => v.id === selected)?.name ?? selected;

  const select = (id: string) => {
    setSelected(id);
    const first = metricsFor(id)[0];
    if (first) setMetricId(first.id);
  };

  return (
    <Stack gap={22} style={{ padding: 4 }}>
      <Stack gap={6}>
        <H1>{RELEASE.title}</H1>
        <Text tone="secondary">
          {RELEASE.packageKind === "base" ? "Base" : "Extension"} vocabulary <Code>{RELEASE.vocabularyId}</Code>, release{" "}
          <Code>{RELEASE.releaseId}</Code> · <Code>{RELEASE.namespace}</Code>
        </Text>
      </Stack>

      {RELEASE.source === "repository-checkout" && (
        <Callout tone="warning" title="Repository source, not a governed release">
          Read from a pinned repository checkout because no Model deployment was reachable. Nothing here is a published
          Model release.
        </Callout>
      )}
      {RELEASE.source === "sample" && (
        <Callout tone="info" title="Synthetic sample data">
          This is the unfilled template. Replace the data block with a governed Model release.
        </Callout>
      )}

      <Row gap={32} wrap>
        <Stat value={String(VERTICES.length)} label="Vertices" />
        <Stat value={String(crossEdges.length)} label="Relationships" />
        {eventCount > 0 && <Stat value={String(eventCount)} label="Event types" />}
        {CATALOGS.length > 0 && <Stat value={String(CATALOGS.length)} label="Metric catalogs" />}
        {METRICS.length > 0 && <Stat value={String(METRICS.length)} label="Metrics" />}
        {RATIOS.length > 0 && <Stat value={String(RATIOS.length)} label="Rates" />}
      </Row>

      <Grid columns="minmax(0, 11fr) minmax(0, 9fr)" gap={20} align="start">
        <Stack gap={10}>
          <H2>Vocabulary graph</H2>
          <Text size="small" tone="tertiary">
            Click a vertex. Arrows are relationships between vertices; events (relationships from a vertex to itself) are
            listed on the vertex. Dashed arrows close a cycle; dashed boxes are imported vertices.
            {METRICS.length > 0 ? " The badge counts metrics rooted on the vertex." : ""}
          </Text>
          <div style={{ border: `1px solid ${theme.stroke.tertiary}`, borderRadius: 8, padding: 8 }}>
            <ModelGraph selected={selected} focusEdges={focusEdges} onSelect={select} />
          </div>

          {RATIOS.length > 0 && (
            <Stack gap={8} style={{ marginTop: 10 }}>
              <H2>Rates</H2>
              <Table
                headers={["Rate", "Question", "Numerator / denominator"]}
                rows={RATIOS.map((r) => [
                  <Code key="i">{r.id}</Code>,
                  r.question,
                  <Stack key="f" gap={2}>
                    <Text size="small">{metricName(r.numerator)}</Text>
                    <div style={{ height: 1, background: theme.stroke.primary }} />
                    <Text size="small">{metricName(r.denominator)}</Text>
                  </Stack>,
                ])}
              />
            </Stack>
          )}

          {CATALOGS.length > 0 && (
            <Stack gap={8} style={{ marginTop: 10 }}>
              <H2>Metric catalogs</H2>
              <Table
                headers={["Catalog", "Origin", "Metrics", "Rates", "Digest"]}
                rows={CATALOGS.map((c) => [
                  <Stack key="c" gap={2}>
                    <Code>{c.catalogId}</Code>
                    {c.sourcePackageNamespace && (
                      <Text size="small" tone="tertiary">
                        {c.sourcePackageNamespace}
                      </Text>
                    )}
                  </Stack>,
                  c.origin,
                  String(c.metrics.length),
                  String(c.ratios.length),
                  <Code key="d">{shortDigest(c.digest)}</Code>,
                ])}
              />
            </Stack>
          )}
        </Stack>

        <Stack gap={14}>
          {rootMetrics.length > 0 && (
            <Card>
              <CardHeader trailing={<Text size="small" tone="tertiary">{`${rootMetrics.length} metrics`}</Text>}>
                {`Metrics on ${selectedName}`}
              </CardHeader>
              <CardBody>
                <Stack gap={8}>
                  {rootMetrics.map((m) => (
                    <MetricCard key={m.id} metric={m} active={m.id === focusMetric?.id} onSelect={() => setMetricId(m.id)} />
                  ))}
                  {vertexRatios.map((r) => (
                    <Text key={r.id} size="small" tone="secondary">
                      Rate <Code>{r.id}</Code>: {metricName(r.numerator)} ÷ {metricName(r.denominator)}
                    </Text>
                  ))}
                </Stack>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader>Vertex definition</CardHeader>
            <CardBody>
              <VertexPanel vertexId={selected} focusMetric={focusMetric} />
            </CardBody>
          </Card>
        </Stack>
      </Grid>

      <Text size="small" tone="tertiary">
        Source: {RELEASE.sourceDetail}, read {RELEASE.readAt}. Release digest {shortDigest(RELEASE.releaseDigest)}
        {RELEASE.sourceDigest ? `, source digest ${shortDigest(RELEASE.sourceDigest)}` : ""}. Snapshot of one immutable
        release; ask Jirachi to regenerate it for a newer release. Highlighted rows mark properties the selected metric
        reads.
      </Text>
    </Stack>
  );
}
