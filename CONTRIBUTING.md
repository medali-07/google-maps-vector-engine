# 🤝 Contributing to Google Maps Vector Engine

We welcome contributions to google-maps-vector-engine! This guide will help you get started.

## 📋 Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contributing Guidelines](#contributing-guidelines)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Code Style](#code-style)
- [Documentation](#documentation)

## 🚀 Getting Started

### Prerequisites

- **Node.js 18+**
- **npm or yarn**
- **Git**
- **TypeScript knowledge**
- **Google Maps API experience** (helpful)

### Development Setup

1. **Fork and clone the repository**:
   ```bash
   git clone https://github.com/your-username/google-maps-vector-engine.git
   cd google-maps-vector-engine
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

4. **Run tests**:
   ```bash
   npm test
   ```

5. **Start development**:
   ```bash
   npm run dev
   ```

### Project Structure

```
google-maps-vector-engine/
├── src/                    # Source code
│   ├── MVTSource.ts       # Main controller
│   ├── MVTLayer.ts        # Layer management
│   ├── MVTFeature.ts      # Feature representation
│   ├── Mercator.ts        # Coordinate utilities
│   ├── ColorUtils.ts      # Color operations
│   ├── DebugLogger.ts     # Logging utilities
│   ├── types.ts           # TypeScript definitions
│   └── index.ts           # Public API exports
├── tests/                  # Test suite
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── utils/             # Test utilities
└── docs/              # Documentation
```

## 📝 Contributing Guidelines

### Types of Contributions

We welcome:
- **Bug fixes** 🐛
- **New features** ✨ 
- **Performance improvements** ⚡
- **Documentation improvements** 📚
- **Test coverage improvements** 🧪
- **Examples and tutorials** 💡

### Before Starting

1. **Check existing issues** - someone might already be working on it
2. **Open an issue** for new features to discuss the approach
3. **Keep changes focused** - one feature/fix per PR
4. **Write tests** for new functionality

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test MVTSource.test.ts

# Run tests in watch mode
npm run test:watch
```

### Test Guidelines

1. **Write tests for new features** - aim for 90%+ coverage
2. **Update tests when changing behavior** 
3. **Use descriptive test names**
4. **Test edge cases and error conditions**
5. **Mock external dependencies** (Google Maps API, fetch calls)

### Test Structure

```typescript
describe('Component/Feature Name', () => {
  describe('specific functionality', () => {
    test('should do something specific', () => {
      // Arrange
      const input = createTestData();
      
      // Act
      const result = functionUnderTest(input);
      
      // Assert
      expect(result).toBe(expectedValue);
    });
  });
});
```

## 🔧 Code Style

### TypeScript Guidelines

1. **Use strict TypeScript** - enable all strict options
2. **Provide complete type annotations** for public APIs
3. **Use meaningful names** for variables, functions, and classes
4. **Avoid `any`** - use proper types or generics
5. **Document public methods** with JSDoc comments

### Code Formatting

We use ESLint and Prettier for consistent formatting:

```bash
# Check formatting
npm run lint

# Fix formatting issues
npm run lint:fix

# Format code
npm run format
```

### Naming Conventions

- **Classes**: PascalCase (`MVTSource`, `ColorUtils`)
- **Functions/Methods**: camelCase (`getTileCoord`, `setStyle`)
- **Constants**: SCREAMING_SNAKE_CASE (`DEFAULT_TILE_SIZE`)
- **Files**: PascalCase for classes, camelCase for utilities

### Example Code Style

```typescript
/**
 * Converts latitude/longitude to tile coordinates
 * @param latLng - The latitude/longitude coordinates
 * @param zoom - The zoom level
 * @returns Tile coordinates object
 */
export function getTileCoord(latLng: LatLng, zoom: number): TileCoord {
  if (!latLng || typeof zoom !== 'number') {
    throw new Error('Invalid parameters');
  }
  
  const scale = 1 << zoom;
  const worldCoord = project(latLng);
  
  return {
    x: Math.floor(worldCoord.x * scale / 256),
    y: Math.floor(worldCoord.y * scale / 256),
    z: zoom
  };
}
```

## 📚 Documentation

### Documentation Requirements

1. **JSDoc comments** for all public APIs
2. **README updates** for new features
3. **Example code** for complex features
4. **Changelog entries** for user-facing changes

### Documentation Style

```typescript
/**
 * Brief description of what the function does
 * 
 * @param paramName - Description of parameter
 * @param optionalParam - Optional parameter description
 * @returns Description of return value
 * @throws {ErrorType} When this error occurs
 * 
 * @example
 * ```typescript
 * const result = myFunction('example', { option: true });
 * console.log(result);
 * ```
 */
```

## 🔄 Submitting Changes

### Pull Request Process

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the guidelines above

3. **Add tests** for new functionality

4. **Update documentation** if needed

5. **Run the full test suite**:
   ```bash
   npm test
   npm run lint
   npm run build
   ```

6. **Commit with clear messages**:
   ```bash
   git commit -m "feat: add new styling feature
   
   - Add support for gradient fills
   - Include tests and documentation
   - Backward compatible with existing styles"
   ```

7. **Push and create pull request**:
   ```bash
   git push origin feature/your-feature-name
   ```

### Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples**:
```bash
feat(styling): add gradient fill support
fix(selection): resolve click detection on overlapping features
docs(readme): update installation instructions
test(mvtsource): add tests for error handling
```

### Pull Request Checklist

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Documentation updated (if applicable)
- [ ] Changelog updated (for user-facing changes)
- [ ] Examples added/updated (for new features)
- [ ] Breaking changes documented

## 🐛 Reporting Issues

### Bug Reports

Include:
1. **Clear description** of the issue
2. **Steps to reproduce** the problem
3. **Expected vs actual behavior**
4. **Environment details**:
   - OS and browser version
   - Node.js version
   - Package version
5. **Minimal code example** that reproduces the issue
6. **Console errors** or relevant logs

### Feature Requests

Include:
1. **Clear description** of the feature
2. **Use case** - why is this needed?
3. **Proposed solution** (if you have ideas)
4. **Alternative solutions** considered
5. **Examples** of similar functionality elsewhere

## 🏆 Recognition

Contributors will be:
- **Listed in CONTRIBUTORS.md**
- **Mentioned in release notes** for significant contributions
- **Given credit** in documentation for major features

## 📞 Getting Help

- **Discussions**: Use GitHub Discussions for questions
- **Issues**: Create an issue for bugs or feature requests
- **Chat**: Join our community discussions

## 📄 License

By contributing, you agree that your contributions will be licensed under the same license as the project (MIT License).

Thank you for contributing to google-maps-vector-engine! 🎉
