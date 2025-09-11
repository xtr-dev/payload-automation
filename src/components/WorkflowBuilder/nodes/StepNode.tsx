'use client'

import React, { memo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'

interface StepNodeData {
  label: string
  stepType: string
  color?: string
  icon?: string
  dependencies?: string[]
}

export const StepNode: React.FC<NodeProps> = memo(({ data, selected }) => {
  const { label, stepType, color = '#3b82f6', icon, dependencies = [] } = data as unknown as StepNodeData

  const getStepTypeIcon = (type: string) => {
    // Return icon from data or default based on type
    if (icon) return icon
    
    switch (type) {
      case 'http-request-step':
        return '🌐'
      case 'create-document-step':
        return '📄'
      case 'read-document-step':
        return '👁️'
      case 'update-document-step':
        return '✏️'
      case 'delete-document-step':
        return '🗑️'
      case 'send-email-step':
        return '📧'
      default:
        return '⚡'
    }
  }

  const getStepTypeLabel = (type: string) => {
    return type.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  return (
    <div
      style={{
        background: color,
        color: 'white',
        borderRadius: '8px',
        padding: '12px 16px',
        minWidth: '150px',
        border: selected ? '2px solid #1e40af' : '1px solid rgba(255, 255, 255, 0.2)',
        boxShadow: selected 
          ? '0 8px 25px rgba(0, 0, 0, 0.15)' 
          : '0 4px 15px rgba(0, 0, 0, 0.1)',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
        position: 'relative'
      }}
      title="Click to configure this step"
    >
      {/* Input Handle - only show if this step has dependencies */}
      {dependencies.length > 0 && (
        <Handle
          type="target"
          position={Position.Top}
          style={{
            background: '#fff',
            border: '2px solid #3b82f6',
            width: '10px',
            height: '10px'
          }}
        />
      )}

      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '8px',
        marginBottom: '4px'
      }}>
        <span style={{ fontSize: '16px' }}>
          {getStepTypeIcon(stepType)}
        </span>
        <div>
          <div style={{ 
            fontWeight: '600', 
            fontSize: '14px',
            lineHeight: '1.2'
          }}>
            {label}
          </div>
        </div>
      </div>

      <div style={{ 
        fontSize: '11px', 
        opacity: 0.9,
        fontWeight: '400'
      }}>
        {getStepTypeLabel(stepType)}
      </div>

      {/* Status indicator for dependencies */}
      {dependencies.length > 0 && (
        <div style={{
          position: 'absolute',
          top: '4px',
          right: '20px',
          background: 'rgba(255, 255, 255, 0.2)',
          borderRadius: '50%',
          width: '16px',
          height: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '8px',
          fontWeight: 'bold',
          pointerEvents: 'none' // Allow clicks to pass through to parent
        }}>
          {dependencies.length}
        </div>
      )}

      {/* Configuration indicator */}
      <div style={{
        position: 'absolute',
        top: '4px',
        right: '4px',
        background: 'rgba(255, 255, 255, 0.3)',
        borderRadius: '50%',
        width: '16px',
        height: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '10px',
        pointerEvents: 'none' // Allow clicks to pass through to parent
      }}>
        ⚙️
      </div>

      {/* Output Handle - always show for potential connections */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: '#fff',
          border: '2px solid #3b82f6',
          width: '10px',
          height: '10px'
        }}
      />
    </div>
  )
})

StepNode.displayName = 'StepNode'