'use client'

import React, { useState, useCallback, useEffect } from 'react'
import type { Node } from '@xyflow/react'
import { Button } from '@payloadcms/ui'

interface StepField {
  name: string
  type: string
  label?: string
  admin?: {
    description?: string
    condition?: (data: any, siblingData: any) => boolean
  }
  options?: Array<{ label: string; value: string }>
  defaultValue?: any
  required?: boolean
  hasMany?: boolean
  fields?: StepField[] // For group fields
}

interface StepType {
  slug: string
  label?: string
  inputSchema?: StepField[]
  outputSchema?: StepField[]
}

interface StepConfigurationFormProps {
  selectedNode: Node | null
  availableStepTypes: StepType[]
  availableSteps: string[] // For dependency selection
  onNodeUpdate: (nodeId: string, data: Partial<Node['data']>) => void
  onClose: () => void
}

export const StepConfigurationForm: React.FC<StepConfigurationFormProps> = ({
  selectedNode,
  availableStepTypes,
  availableSteps,
  onNodeUpdate,
  onClose
}) => {
  const [formData, setFormData] = useState<Record<string, any>>(
    selectedNode?.data.configuration || {}
  )
  const [jsonText, setJsonText] = useState<string>(() => 
    JSON.stringify(selectedNode?.data.configuration || {}, null, 2)
  )

  if (!selectedNode) return null

  const stepType = availableStepTypes.find(type => type.slug === selectedNode.data.stepType)
  const inputSchema = stepType?.inputSchema || []

  // Update form data when selected node changes
  useEffect(() => {
    const config = selectedNode?.data.configuration || {}
    setFormData(config)
    setJsonText(JSON.stringify(config, null, 2))
  }, [selectedNode])


  const handleSave = useCallback(() => {
    // Update the node with form data
    onNodeUpdate(selectedNode.id, {
      ...selectedNode.data,
      configuration: formData
    })
    
    onClose()
  }, [selectedNode, formData, onNodeUpdate, onClose])

  const renderStepConfiguration = () => {
    if (!inputSchema.length) {
      return (
        <div style={{ 
          padding: '20px',
          textAlign: 'center',
          color: 'var(--theme-text-400)',
          fontStyle: 'italic'
        }}>
          This step type has no configuration parameters.
        </div>
      )
    }

    return (
      <div style={{ marginBottom: '16px' }}>
        <label style={{ 
          display: 'block', 
          marginBottom: '4px', 
          fontSize: '12px', 
          fontWeight: '500',
          color: 'var(--theme-text)' 
        }}>
          Step Configuration
        </label>
        <div style={{ fontSize: '11px', color: 'var(--theme-text-400)', marginBottom: '8px' }}>
          Configure this step's parameters in JSON format. Use JSONPath expressions like <code>$.trigger.doc.id</code> to reference dynamic data.
        </div>
        
        {/* Schema Reference */}
        <details style={{ marginBottom: '12px' }}>
          <summary style={{ 
            fontSize: '11px', 
            color: 'var(--theme-text-400)', 
            cursor: 'pointer',
            marginBottom: '8px'
          }}>
            📖 Available Fields (click to expand)
          </summary>
          <div style={{ 
            background: 'var(--theme-elevation-50)',
            border: '1px solid var(--theme-elevation-100)',
            borderRadius: '4px',
            padding: '12px',
            fontSize: '11px',
            fontFamily: 'monospace'
          }}>
            {inputSchema.map((field, index) => (
              <div key={field.name} style={{ marginBottom: index < inputSchema.length - 1 ? '8px' : '0' }}>
                <strong>{field.name}</strong> ({field.type})
                {field.required && <span style={{ color: 'var(--theme-error-500)' }}> *required</span>}
                {field.admin?.description && (
                  <div style={{ color: 'var(--theme-text-400)', marginTop: '2px' }}>
                    {field.admin.description}
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>

        <textarea
          value={jsonText}
          onChange={(e) => {
            const text = e.target.value
            setJsonText(text)
            try {
              const parsed = JSON.parse(text)
              setFormData(parsed)
            } catch {
              // Keep invalid JSON, user is still typing
              // Don't update formData until JSON is valid
            }
          }}
          rows={Math.min(Math.max(inputSchema.length * 2, 6), 15)}
          style={{
            width: '100%',
            padding: '12px',
            border: '1px solid var(--theme-elevation-100)',
            borderRadius: '4px',
            fontSize: '13px',
            fontFamily: 'monospace',
            lineHeight: '1.4',
            background: 'var(--theme-input-bg)',
            color: 'var(--theme-text)',
            resize: 'vertical'
          }}
          placeholder='{\n  "field1": "value1",\n  "field2": "$.trigger.doc.id"\n}'
        />
      </div>
    )
  }

  return (
    <div style={{
      height: '100%',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--theme-elevation-100)',
        background: 'var(--theme-elevation-50)'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center' 
        }}>
          <h4 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: 'var(--theme-text)' }}>
            Configure Step
          </h4>
          <Button
            buttonStyle="none"
            onClick={onClose}
            size="small"
          >
            ×
          </Button>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--theme-text-400)', marginTop: '4px' }}>
          {stepType?.label || (selectedNode.data.stepType as string)}
        </div>
      </div>

      {/* Form */}
      <div style={{ 
        flex: 1, 
        overflow: 'auto', 
        padding: '16px' 
      }}>
        {/* Basic step info */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ 
            display: 'block', 
            marginBottom: '4px', 
            fontSize: '12px', 
            fontWeight: '500' 
          }}>
            Step Name *
          </label>
          <input
            type="text"
            value={(selectedNode.data.label as string) || ''}
            onChange={(e) => onNodeUpdate(selectedNode.id, { 
              ...selectedNode.data, 
              label: e.target.value 
            })}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid var(--theme-elevation-100)',
              borderRadius: '4px',
              fontSize: '14px'
            }}
            required
          />
        </div>

        {/* Dependencies */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ 
            display: 'block', 
            marginBottom: '4px', 
            fontSize: '12px', 
            fontWeight: '500' 
          }}>
            Dependencies
          </label>
          <div style={{ fontSize: '11px', color: 'var(--theme-text-400)', marginBottom: '8px' }}>
            Steps that must complete before this step can run
          </div>
          {availableSteps
            .filter(step => step !== selectedNode.id)
            .map(stepId => (
            <label key={stepId} style={{ 
              display: 'block', 
              fontSize: '12px', 
              marginBottom: '4px' 
            }}>
              <input
                type="checkbox"
                checked={((selectedNode.data.dependencies as string[]) || []).includes(stepId)}
                onChange={(e) => {
                  const currentDeps = (selectedNode.data.dependencies as string[]) || []
                  const newDeps = e.target.checked
                    ? [...currentDeps, stepId]
                    : currentDeps.filter((dep: string) => dep !== stepId)
                  
                  onNodeUpdate(selectedNode.id, {
                    ...selectedNode.data,
                    dependencies: newDeps
                  })
                }}
                style={{ marginRight: '8px' }}
              />
              {stepId}
            </label>
          ))}
        </div>

        {/* Step-specific configuration */}
        {renderStepConfiguration()}

        {/* Submit button */}
        <div style={{ 
          borderTop: '1px solid var(--theme-elevation-100)', 
          paddingTop: '16px', 
          marginTop: '16px' 
        }}>
          <Button
            buttonStyle="primary"
            onClick={handleSave}
          >
            Save Configuration
          </Button>
        </div>
      </div>
    </div>
  )
}