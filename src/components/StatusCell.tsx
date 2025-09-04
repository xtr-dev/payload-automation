'use client'

import React from 'react'

interface StatusCellProps {
  cellData: string
}

export const StatusCell: React.FC<StatusCellProps> = ({ cellData }) => {
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'pending':
        return { icon: '⏳', color: '#6B7280', label: 'Pending' }
      case 'running':
        return { icon: '🔄', color: '#3B82F6', label: 'Running' }
      case 'completed':
        return { icon: '✅', color: '#10B981', label: 'Completed' }
      case 'failed':
        return { icon: '❌', color: '#EF4444', label: 'Failed' }
      case 'cancelled':
        return { icon: '⏹️', color: '#F59E0B', label: 'Cancelled' }
      default:
        return { icon: '❓', color: '#6B7280', label: status || 'Unknown' }
    }
  }

  const { icon, color, label } = getStatusDisplay(cellData)

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '4px 8px',
      borderRadius: '6px',
      backgroundColor: `${color}15`,
      border: `1px solid ${color}30`,
      fontSize: '14px',
      fontWeight: '500'
    }}>
      <span style={{ fontSize: '16px' }}>{icon}</span>
      <span style={{ color }}>{label}</span>
    </div>
  )
}