import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
	{
		ignores: ['node_modules/**', '.wrangler/**', 'public/**']
	},
	js.configs.recommended,
	{
		files: ['src/**/*.ts', 'test/**/*.ts'],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 'latest',
			sourceType: 'module'
		},
		plugins: {
			'@typescript-eslint': tsPlugin
		},
		rules: {
			...tsPlugin.configs.recommended.rules,
			'no-undef': 'off',
			'no-useless-assignment': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-empty-object-type': 'off',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			]
		}
	}
];
