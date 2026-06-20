import { SegmentView } from "./SegmentView";

// Next 16: params is async.
export default async function SegmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SegmentView id={id} />;
}
