'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useField, useFormFields } from '@payloadcms/ui'
import { WorkflowBuilder } from '../components/WorkflowBuilder/index.js'

// Import the step types from the steps module
import * as stepTasks from '../steps/index.js'

// Extract available step types from imported tasks
const getAvailableStepTypes = () => {
  const stepTypes: Array<{
    slug: string
    label?: string
    inputSchema?: any[]
    outputSchema?: any[]
  }> = []

  // Get all exported step tasks
  const tasks = [
    stepTasks.HttpRequestStepTask,
    stepTasks.CreateDocumentStepTask,
    stepTasks.ReadDocumentStepTask,
    stepTasks.UpdateDocumentStepTask,
    stepTasks.DeleteDocumentStepTask,
    stepTasks.SendEmailStepTask
  ]

  tasks.forEach(task => {
    if (task && task.slug) {
      stepTypes.push({
        slug: task.slug,
        label: undefined, // Tasks don't have labels, will use slug
        inputSchema: task.inputSchema,
        outputSchema: task.outputSchema
      })
    }
  })

  return stepTypes
}

interface WorkflowBuilderFieldProps {
  name?: string
  path?: string
}

export const WorkflowBuilderField: React.FC<WorkflowBuilderFieldProps> = ({ 
  name, 
  path
}) => {
  const availableStepTypes = getAvailableStepTypes()
  const { value: steps, setValue: setSteps } = useField<any>({ path: 'steps' })
  const { value: layout, setValue: setLayout } = useField<any>({ path: 'layout' })
  const { value: workflowName } = useField<string>({ path: 'name' })
  
  const [workflowData, setWorkflowData] = useState<any>({
    id: 'temp',
    name: workflowName || 'Workflow',
    steps: steps || [],
    layout: layout || {}
  })

  // Update local state when form fields change
  useEffect(() => {
    setWorkflowData({
      id: 'temp',
      name: workflowName || 'Workflow',
      steps: steps || [],
      layout: layout || {}
    })
  }, [steps, layout, workflowName])

  const handleSave = useCallback((updatedWorkflow: any) => {
    // Update the form fields
    if (updatedWorkflow.steps) {
      setSteps(updatedWorkflow.steps)
    }
    if (updatedWorkflow.layout) {
      setLayout(updatedWorkflow.layout)
    }
  }, [setSteps, setLayout])

  return (
    <div style={{ 
      marginTop: '20px',
      marginBottom: '20px',
      border: '1px solid var(--theme-elevation-100)',
      borderRadius: '4px',
      overflow: 'hidden'
    }}>
      <div style={{
        background: 'var(--theme-elevation-50)',
        padding: '12px 16px',
        borderBottom: '1px solid var(--theme-elevation-100)'
      }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: 'var(--theme-text)' }}>
          Visual Workflow Builder
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--theme-text-400)' }}>
          Drag and drop steps to build your workflow visually. Click on any step to configure its parameters.
        </p>
      </div>
      
      <WorkflowBuilder
        workflow={workflowData}
        availableStepTypes={availableStepTypes}
        onSave={handleSave}
        readonly={false}
      />
    </div>
  )
}