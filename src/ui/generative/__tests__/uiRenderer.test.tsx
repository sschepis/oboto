import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom'; // Import matchers
import { UiRenderer } from '../uiRenderer';
import { componentRegistry } from '../componentRegistry';

// Mock component registry
jest.mock('../componentRegistry', () => ({
  componentRegistry: {
    get: jest.fn(),
  },
}));

describe('UiRenderer', () => {
  const mockManifest: any = {
    project_id: 'test-proj',
    layout: 'grid',
    components: [
      { id: '1', type: 'visualization', component: 'MetricCard', props: { title: 'Test Metric' } },
      { id: '2', type: 'control', component: 'UnknownComponent' },
    ],
  };

  beforeEach(() => {
    (componentRegistry.get as jest.Mock).mockImplementation((name) => {
      if (name === 'MetricCard') {
        // @ts-ignore
        return ({ title }: { title: string }) => <div>{title}</div>;
      }
      return undefined;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should render known components correctly', () => {
    render(<UiRenderer manifest={mockManifest} />);
    expect(screen.getByText('Test Metric')).toBeInTheDocument();
  });

  it('should render placeholder for unknown components', () => {
    render(<UiRenderer manifest={mockManifest} />);
    expect(screen.getByText('Unknown Component: UnknownComponent')).toBeInTheDocument();
  });

  it('should handle empty manifest gracefully', () => {
    const emptyManifest: any = { project_id: 'empty', layout: 'grid', components: [] };
    render(<UiRenderer manifest={emptyManifest} />);
    expect(screen.queryByText(/Unknown Component/)).not.toBeInTheDocument();
  });

  it('should handle manifest updates', () => {
    const { rerender } = render(<UiRenderer manifest={mockManifest} />);
    expect(screen.getByText('Test Metric')).toBeInTheDocument();

    const newManifest: any = {
      ...mockManifest,
      components: [
        { id: '3', type: 'visualization', component: 'MetricCard', props: { title: 'Updated Metric' } },
      ],
    };

    rerender(<UiRenderer manifest={newManifest} />);
    expect(screen.getByText('Updated Metric')).toBeInTheDocument();
    expect(screen.queryByText('Test Metric')).not.toBeInTheDocument();
  });
});
