import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  // 1. Global ignores
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/dist-web/',
      '**/panel-dist/',
      '**/coverage/',
      '**/.vite/',
      '**/vendor/',
      '.claude/worktrees/',
      '**/target/',
    ],
  },

  // 2. Base config for all JS/JSX files
  {
    files: ['**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },

  // 3. Node.js config for server-side packages
  {
    files: [
      'packages/provisioners/server/**/*.js',
      'packages/server/daemon/**/*.js',
      'packages/server/cli/**/*.js',
      'packages/agent/cli/**/*.js',
      'packages/agent/daemon/**/*.js',
      'packages/provisioners/desktop/**/*.js',
      'packages/provisioners/admin/**/*.js',
      'packages/provisioners/agent/**/*.js',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-process-exit': 'off',
    },
  },

  // 4. React/Browser config for lamaste-server-ui
  {
    files: ['packages/server/ui/**/*.{js,jsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // 5. React config for lamaste-agent-ui
  {
    files: ['packages/agent/ui/**/*.{js,jsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // 6. React/Browser config for lamaste-desktop
  {
    files: ['packages/clients/desktop/**/*.{js,jsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // 7. TypeScript config for lamaste-tickets
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['packages/sdks/tickets/src/**/*.ts'],
  })),
  {
    files: ['packages/sdks/tickets/src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // 8. Prettier compat — must be last to disable formatting rules
  prettierConfig,
];
