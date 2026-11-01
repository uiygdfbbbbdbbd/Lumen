import base from '@lumen/eslint-config';
import hooks from 'eslint-plugin-react-hooks';
export default [...base, { plugins: { 'react-hooks': hooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } }];
