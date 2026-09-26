"""Long-term memory service using mem0 and pgvector with optional cache layer."""

import base64

import openlit
from langfuse import observe
from mem0 import AsyncMemory
from mem0.embeddings.openai import OpenAIEmbedding

from app.core.cache import (
    cache_key,
    cache_service,
)
from app.core.config import settings
from app.core.logging import logger


def _embed_without_dimensions(self: OpenAIEmbedding, text: str, memory_action: str | None = None) -> list[float]:
    """Embed text without the ``dimensions`` argument.

    mem0's OpenAI embedding provider always sends ``dimensions=1536``, but
    Volcengine Ark embedding models (e.g. ``doubao-embedding-vision``) reject
    that parameter with ``InvalidParameter: dimensions``. Keep the signature
    compatible with mem0's callers, but drop the failing parameter.
    """
    del memory_action
    text = text.replace("\n", " ")
    return self.client.embeddings.create(input=[text], model=self.config.model).data[0].embedding


# mem0 hard-codes ``dimensions=1536``; Ark embedding endpoints don't accept it.
# Patch before any AsyncMemory instance is built so it applies universally.
OpenAIEmbedding.embed = _embed_without_dimensions


def _init_openlit() -> None:
    """Route openlit-instrumented spans (mem0 operations) to Langfuse.

    openlit 1.45 dropped the ``tracer`` argument from ``openlit.init()``; spans
    are exported over OTLP instead. Langfuse 3.x exposes an OTLP receiver at
    ``{LANGFUSE_HOST}/api/public/otel/v1/traces`` authenticated with Basic Auth
    (``public_key:secret_key``).

    Only the mem0 instrumentor is enabled. Everything else is disabled so the
    main LangChain/LangGraph LLM calls (already traced via the Langfuse callback
    handler) are not duplicated as standalone OTLP spans.
    """
    if not settings.LANGFUSE_TRACING_ENABLED or not settings.LANGFUSE_PUBLIC_KEY:
        logger.debug("openlit_init_skipped_tracing_disabled")
        return

    basic_auth = "Basic " + base64.b64encode(
        f"{settings.LANGFUSE_PUBLIC_KEY}:{settings.LANGFUSE_SECRET_KEY}".encode("utf-8")
    ).decode("ascii")

    # All openlit instrumentors except mem0. Kept in sync with openlit's
    # MODULE_NAME_MAP so only mem0 spans are produced.
    # disabled_instrumentors = [
    #     name
    #     for name in [
    #         "openai",
    #         "anthropic",
    #         "cohere",
    #         "mistral",
    #         "bedrock",
    #         "oci",
    #         "vertexai",
    #         "groq",
    #         "ollama",
    #         "gpt4all",
    #         "elevenlabs",
    #         "vllm",
    #         "google-ai-studio",
    #         "azure-ai-inference",
    #         "langchain",
    #         "langgraph",
    #         "llama_index",
    #         "haystack",
    #         "chroma",
    #         "pinecone",
    #         "qdrant",
    #         "milvus",
    #         "transformers",
    #         "litellm",
    #         "crewai",
    #         "ag2",
    #         "autogen",
    #         "pyautogen",
    #         "multion",
    #         "dynamiq",
    #         "agno",
    #         "reka-api",
    #         "premai",
    #         "julep",
    #         "astra",
    #         "ai21",
    #         "controlflow",
    #         "assemblyai",
    #         "crawl4ai",
    #         "firecrawl",
    #         "letta",
    #         "together",
    #         "pydo",
    #         "gradient",
    #         "openai-agents",
    #         "pydantic_ai",
    #         "sarvam",
    #         "browser-use",
    #         "mcp",
    #         "google-adk",
    #         "smolagents",
    #         "claude-agent-sdk",
    #         "aiohttp-client",
    #         "httpx",
    #         "requests",
    #         "urllib",
    #         "urllib3",
    #         "fastapi",
    #         "starlette",
    #         "psycopg",
    #         "psycopg-pool",
    #         "agent-framework",
    #     ]
    # ]

    openlit.init(
        otlp_endpoint=f"{settings.LANGFUSE_HOST}/api/public/otel",
        otlp_headers={"Authorization": basic_auth},
        disable_batch=True,
        # disabled_instrumentors=disabled_instrumentors,
    )
    logger.info("openlit_initialized_for_langfuse", host=settings.LANGFUSE_HOST)


_init_openlit()


class MemoryService:
    """Service for managing long-term memory using mem0 and pgvector."""

    def __init__(self):
        """Initialize the memory service."""
        self._memory: AsyncMemory | None = None

    async def _get_memory(self) -> AsyncMemory:
        if self._memory is None:
            self._memory = await AsyncMemory.from_config(
                config_dict={
                    "vector_store": {
                        "provider": "pgvector",
                        "config": {
                            "collection_name": settings.LONG_TERM_MEMORY_COLLECTION_NAME,
                            "embedding_model_dims": 2048,
                            "hnsw": False,
                            "dbname": settings.POSTGRES_DB,
                            "user": settings.POSTGRES_USER,
                            "password": settings.POSTGRES_PASSWORD,
                            "host": settings.POSTGRES_HOST,
                            "port": settings.POSTGRES_PORT,
                        },
                    },
                    "llm": {
                        "provider": "openai",
                        "config": {"model": settings.LONG_TERM_MEMORY_MODEL},
                    },
                    "embedder": {
                        "provider": "openai",
                        "config": {"model": settings.LONG_TERM_MEMORY_EMBEDDER_MODEL},
                    },
                }
            )
        return self._memory

    async def initialize(self) -> None:
        """Pre-warm the mem0 AsyncMemory instance and its pgvector connection pool.

        Call once at startup so the first search() or add() doesn't pay the
        ~130ms from_config + pgvector.list_cols() cold-init cost.
        """
        await self._get_memory()
        logger.info("memory_service_initialized")

    @observe(as_type="span")
    async def search(self, user_id: str | None, query: str) -> str:
        """Search relevant memories for a user.

        Checks cache first; on miss, queries mem0 and caches the result.

        Returns formatted memory string, or empty string on failure or when
        no user_id is supplied (anonymous sessions skip long-term memory
        rather than pooling under a shared partition).
        """
        if user_id is None:
            return ""
        try:
            # Check cache first
            key = cache_key("memory", str(user_id), query)
            cached = await cache_service.get(key)
            if cached is not None:
                logger.debug("memory_search_cache_hit", user_id=user_id)
                return cached

            memory = await self._get_memory()
            results = await memory.search(user_id=str(user_id), query=query)
            result = "\n".join([f"* {r['memory']}" for r in results["results"]])

            # Cache successful results
            if result:
                await cache_service.set(key, result)

            return result
        except Exception as e:
            logger.error("failed_to_get_relevant_memory", error=str(e), user_id=user_id, query=query)
            return ""

    @observe(as_type="span")
    async def add(self, user_id: str | None, messages: list[dict], metadata: dict | None = None) -> None:
        """Add messages to long-term memory for a user.

        No-op when ``user_id`` is ``None`` (see ``search`` for rationale).
        """
        if user_id is None:
            return
        try:
            memory = await self._get_memory()
            await memory.add(messages, user_id=str(user_id), metadata=metadata)
            logger.info("long_term_memory_updated_successfully", user_id=user_id)
        except Exception as e:
            logger.exception("failed_to_update_long_term_memory", user_id=user_id, error=str(e))


memory_service = MemoryService()
