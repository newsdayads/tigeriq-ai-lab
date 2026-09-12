export async function getPipelineTruth() {
  return {
    pipelineState: 'ACTIVE',
    activeWorkers: 4,
    throughput: '1250 msgs/sec',
    errorRate: '0.01%',
    lastUpdated: new Date().toISOString(),
    nodes: [
      { id: 'ingest', name: 'Data Ingestion', status: 'healthy', latency: '12ms' },
      { id: 'transform', name: 'Stream Transform', status: 'healthy', latency: '45ms' },
      { id: 'durable-sink', name: 'Durable Sink', status: 'healthy', latency: '8ms' }
    ]
  };
}
