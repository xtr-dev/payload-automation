'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { 
  ReactFlow,
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  Panel
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

// Import custom node types
import { StepNode } from './nodes/StepNode.js'
import { WorkflowToolbar } from './WorkflowToolbar.js'
import { StepConfigurationForm } from './StepConfigurationForm.js'

// Define node types for React Flow
const nodeTypes = {
  stepNode: StepNode,
}

interface WorkflowData {
  id: string
  name: string
  steps?: Array<{
    name: string
    type: string
    position?: { x: number; y: number }
    visual?: { color?: string; icon?: string }
    dependencies?: string[]
  }>
  layout?: {
    viewport?: { x: number; y: number; zoom: number }
  }
}

interface StepType {
  slug: string
  label?: string
  inputSchema?: any[]
  outputSchema?: any[]
}

interface WorkflowBuilderProps {
  workflow?: WorkflowData
  availableStepTypes?: StepType[]
  onSave?: (workflow: WorkflowData) => void
  readonly?: boolean
}

export const WorkflowBuilder: React.FC<WorkflowBuilderProps> = ({
  workflow,
  availableStepTypes = [],
  onSave,
  readonly = false
}) => {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)

  // Convert workflow steps to React Flow nodes
  const initialNodes: Node[] = useMemo(() => {
    if (!workflow?.steps) return []

    return workflow.steps.map((step, index) => ({
      id: step.name || `step-${index}`,
      type: 'stepNode',
      position: step.position || { x: 100 + index * 200, y: 100 },
      data: {
        label: step.name || 'Unnamed Step',
        stepType: step.type,
        color: step.visual?.color || '#3b82f6',
        icon: step.visual?.icon,
        dependencies: step.dependencies || []
      }
    }))
  }, [workflow?.steps])

  // Convert dependencies to React Flow edges
  const initialEdges: Edge[] = useMemo(() => {
    if (!workflow?.steps) return []

    const edges: Edge[] = []
    
    workflow.steps.forEach((step, index) => {
      const targetId = step.name || `step-${index}`
      
      if (step.dependencies) {
        step.dependencies.forEach((depName) => {
          // Find the source step
          const sourceStep = workflow.steps?.find(s => s.name === depName)
          if (sourceStep) {
            const sourceId = sourceStep.name || `step-${workflow.steps?.indexOf(sourceStep)}`
            edges.push({
              id: `${sourceId}-${targetId}`,
              source: sourceId,
              target: targetId,
              type: 'smoothstep'
            })
          }
        })
      }
    })

    return edges
  }, [workflow?.steps])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Handle new connections
  const onConnect = useCallback((params: Connection) => {
    if (readonly) return
    
    setEdges((eds: Edge[]) => addEdge({
      ...params,
      type: 'smoothstep'
    }, eds))
  }, [setEdges, readonly])

  // Handle node selection
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    console.log('Node clicked:', node.id, node.data.label)
    setSelectedNode(node)
  }, [])

  // Handle adding new step
  const onAddStep = useCallback((stepType: string) => {
    if (readonly) return

    const newStep: Node = {
      id: `step-${Date.now()}`,
      type: 'stepNode',
      position: { x: 100, y: 100 },
      data: {
        label: 'New Step',
        stepType,
        color: '#3b82f6',
        dependencies: []
      }
    }

    setNodes((nds: Node[]) => [...nds, newStep])
  }, [setNodes, readonly])

  // Handle updating a node's data
  const handleNodeUpdate = useCallback((nodeId: string, newData: Partial<Node['data']>) => {
    setNodes((nds: Node[]) =>
      nds.map((node: Node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...newData } }
          : node
      )
    )
  }, [setNodes])

  // Handle saving workflow
  const handleSave = useCallback(() => {
    if (!workflow || !onSave) return

    // Convert nodes and edges back to workflow format
    const updatedSteps = nodes.map((node: Node) => {
      // Find dependencies from edges
      const dependencies = edges
        .filter((edge: Edge) => edge.target === node.id)
        .map((edge: Edge) => edge.source)

      return {
        name: node.id,
        type: node.data.stepType as string,
        position: node.position,
        visual: {
          color: node.data.color as string,
          icon: node.data.icon as string
        },
        dependencies: dependencies.length > 0 ? dependencies : undefined
      }
    })

    const updatedWorkflow: WorkflowData = {
      ...workflow,
      steps: updatedSteps
    }

    onSave(updatedWorkflow)
  }, [workflow, nodes, edges, onSave])

  return (
    <div style={{ 
      width: '100%', 
      height: '600px',
      display: 'flex',
      background: 'var(--theme-bg)',
      borderRadius: '4px',
      border: '1px solid var(--theme-elevation-100)'
    }}>
      {/* Main canvas area */}
      <div style={{ 
        flex: selectedNode ? '1 1 70%' : '1 1 100%',
        transition: 'flex 0.3s ease'
      }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="top-right"
        >
          <Controls />
          <MiniMap />
          <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
          
          {!readonly && (
            <Panel position="top-left">
              <WorkflowToolbar 
                availableStepTypes={availableStepTypes}
                onAddStep={onAddStep}
                onSave={handleSave}
              />
            </Panel>
          )}
        </ReactFlow>
      </div>

      {/* Side panel for step configuration */}
      {selectedNode && !readonly && (
        <div style={{
          flex: '0 0 30%',
          borderLeft: '1px solid var(--theme-elevation-100)',
          background: 'var(--theme-elevation-0)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <StepConfigurationForm
            selectedNode={selectedNode}
            availableStepTypes={availableStepTypes}
            availableSteps={nodes.map((node: Node) => node.id)}
            onNodeUpdate={handleNodeUpdate}
            onClose={() => setSelectedNode(null)}
          />
        </div>
      )}
    </div>
  )
}