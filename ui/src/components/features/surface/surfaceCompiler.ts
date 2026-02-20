/* eslint-disable no-unused-expressions, @typescript-eslint/no-unused-expressions */
/**
 * Surface Component Compiler
 * Transpiles JSX source code into React components within a sandboxed scope.
 */
import React, { useState, useMemo } from 'react';
import { transform } from 'sucrase';
import { UI } from '../../../surface-kit';
import { surfaceApi } from './surfaceApi';

/**
 * Module shim for surface component sandbox.
 * When the AI generates `import X from 'react'` or similar,
 * sucrase converts it to `var X = require('react')`.
 */
const sandboxModules: Record<string, unknown> = {
  react: React,
  React: React,
};

export const sandboxRequire = (moduleName: string): unknown => {
  const mod = sandboxModules[moduleName];
  if (mod) return mod;
  console.warn(`[Surface] Unknown import: "${moduleName}" — surface components should not use imports.`);
  return {};
};

/**
 * Compile a JSX source string into a React component.
 * @param source Raw JSX/TSX source code
 * @param componentName Name for error messages
 * @param useSurfaceLifecycle Optional lifecycle hook to inject
 */
export const compileComponent = (
  source: string,
  componentName: string,
  useSurfaceLifecycle?: () => unknown
): React.ComponentType<unknown> | null => {
  try {
    const cleanedSource = source.replace(/^\s*import\s+type\s+\{[^}]*\}\s+from\s+['"][^'"]*['"];?\s*$/gm, '');

    const { code } = transform(cleanedSource, {
      transforms: ['jsx', 'typescript', 'imports'],
      production: true,
    });

    const moduleFactory = new Function(
      'React', 'useState', 'useEffect', 'useRef', 'useCallback', 'useMemo',
      'surfaceApi', 'UI', 'useSurfaceLifecycle', 'exports', 'require', 'module',
      code
    );

    const exports: { default?: React.ComponentType<unknown> } = {};
    const module = { exports };

    const lifecycleHook = useSurfaceLifecycle || (() => ({
      isFocused: true, onFocus: () => () => {}, onBlur: () => () => {},
      onMount: () => () => {}, onUnmount: () => () => {}
    }));

    moduleFactory(
      React, useState, React.useEffect, React.useRef, React.useCallback, useMemo,
      surfaceApi, UI, lifecycleHook, exports, sandboxRequire, module
    );

    return exports.default || (module.exports as { default?: React.ComponentType<unknown> }).default || null;
  } catch (err) {
    console.error(`Failed to compile component ${componentName}:`, err);
    throw err;
  }
};
