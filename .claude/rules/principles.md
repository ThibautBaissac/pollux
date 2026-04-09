# Development Principles

- **KISS**: Prefer standard CRUD endpoints and conventional routing. No abstractions until complexity demands it. If a junior developer can't understand it in 30 seconds, simplify it.
- **DRY is about knowledge, not code**: Every piece of knowledge has one authoritative representation. But three similar lines are better than a premature abstraction -- duplicate code is cheaper than the wrong abstraction.
- **YAGNI**: Implement only what is currently required. Don't add configuration options, feature flags, or patterns for hypothetical future needs. Start simple, extract later.
- **SRP**: Each class has one reason to change. A model handles persistence, a service handles business logic, a controller handles HTTP orchestration.
- **Dependency Inversion**: Inject collaborators via constructor for testability. High-level business logic should not depend on low-level modules.
- **Composition over inheritance**: Favor mixins, shared modules, and delegation over deep class hierarchies.
- **Skinny Everything**: Controllers orchestrate (delegate to services, render responses). Models persist (validations, associations, scopes, simple predicates). Services contain business logic. Views display markup with no logic.
- **No premature abstraction**: Don't create base classes, helpers, or utilities for one-time operations. Extract only when you have 5+ concrete implementations with identical structure.
- **Explicit over implicit**: Clear code wins over magic. Explicit service calls over hidden callbacks. Named methods over metaprogramming.
