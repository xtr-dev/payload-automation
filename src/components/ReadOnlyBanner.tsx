'use client'

import React from 'react'

export const ReadOnlyBanner: React.FC = () => {
  return (
    <div
      style={{
        backgroundColor: '#fef3c7',
        border: '1px solid #f59e0b',
        borderRadius: '4px',
        padding: '12px 16px',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#f59e0b"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div>
        <strong style={{ color: '#92400e' }}>Read-Only Workflow</strong>
        <p style={{ margin: '4px 0 0 0', color: '#78350f', fontSize: '14px' }}>
          This is a template workflow that cannot be edited or deleted. You can view it for reference or duplicate it to create your own version.
        </p>
      </div>
    </div>
  )
}
