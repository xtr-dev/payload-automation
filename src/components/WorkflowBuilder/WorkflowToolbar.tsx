'use client'

import React from 'react'

interface AvailableStepType {
  slug: string
  label?: string
  inputSchema?: any[]
  outputSchema?: any[]
}

interface WorkflowToolbarProps {
  availableStepTypes: AvailableStepType[]
  onAddStep: (stepType: string) => void
  onSave: () => void
}

export const WorkflowToolbar: React.FC<WorkflowToolbarProps> = ({
  availableStepTypes,
  onAddStep,
  onSave
}) => {
  const getStepTypeLabel = (stepType: AvailableStepType) => {
    return stepType.label || stepType.slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  }

  const getStepTypeIcon = (stepType: AvailableStepType) => {
    // Simple icon mapping based on step type
    switch (stepType.slug) {
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

  return (
    <div style={{
      background: 'var(--theme-elevation-0)',
      padding: '12px',
      borderRadius: '4px',
      border: '1px solid var(--theme-elevation-150)',
      minWidth: '200px'
    }}>
      <h4 style={{ 
        margin: '0 0 12px 0', 
        fontSize: '14px', 
        fontWeight: '600',
        color: 'var(--theme-text)'
      }}>
        Add Step
      </h4>
      
      <div style={{ marginBottom: '16px' }}>
        {availableStepTypes.map((stepType) => (
          <button
            key={stepType.slug}
            onClick={() => onAddStep(stepType.slug)}
            style={{
              display: 'block',
              width: '100%',
              padding: '8px 12px',
              margin: '4px 0',
              background: 'var(--theme-elevation-50)',
              border: '1px solid var(--theme-elevation-100)',
              borderRadius: '4px',
              cursor: 'pointer',
              textAlign: 'left',
              fontSize: '12px',
              color: 'var(--theme-text)',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--theme-elevation-100)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--theme-elevation-50)'
            }}
          >
            <span style={{ marginRight: '8px' }}>
              {getStepTypeIcon(stepType)}
            </span>
            {getStepTypeLabel(stepType)}
          </button>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--theme-elevation-100)', paddingTop: '12px' }}>
        <button
          onClick={onSave}
          style={{
            width: '100%',
            padding: '8px 16px',
            background: 'var(--theme-success-500)',
            color: 'var(--theme-base-0)',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: '500'
          }}
        >
          💾 Save Workflow
        </button>
      </div>
    </div>
  )
}