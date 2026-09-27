"""Long-term memory service using mem0 and pgvector with optional cache layer."""


from langfuse import observe
from mem0 import AsyncMemory
from mem0.embeddings.openai import OpenAIEmbedding
from mem0.llms.openai import OpenAILLM

from app.core.cache import (
    cache_key,
    cache_service,
)
from app.core.config import settings
from app.core.logging import logger


@observe(as_type="embedding", name="mem0.embed", capture_output=False)
def _embed_without_dimensions(self: OpenAIEmbedding, text: str, memory_action: str | None = None) -> list[float]:
    """Embed text without the ``dimensions`` argument.

    mem0's OpenAI embedding provider always sends ``dimensions=1536``, but
    Volcengine Ark embedding models (e.g. ``doubao-embedding-vision``) reject
    that parameter with ``InvalidParameter: dimensions``. Keep the signature
    compatible with mem0's callers, but drop the failing parameter.

    The ``@observe`` decorator surfaces every embedding call as a Langfuse
    span, restoring part of the mem0 call chain that was lost when the openlit
    OTLP bridge was removed.
    """
    del memory_action
    text = text.replace("\n", " ")
    return self.client.embeddings.create(input=[text], model=self.config.model).data[0].embedding


# mem0 hard-codes ``dimensions=1536``; Ark embedding endpoints don't accept it.
# Patch before any AsyncMemory instance is built so it applies universally.
OpenAIEmbedding.embed = _embed_without_dimensions


_ORIGINAL_LLM_GENERATE_RESPONSE = OpenAILLM.generate_response


@observe(as_type="generation", name="mem0.fact_extraction")
def _generate_response_without_thinking(self: OpenAILLM, messages: list[dict], **kwargs) -> str:
    """Generate a completion with thinking disabled, traced to Langfuse.

    mem0's OpenAI LLM provider exposes no reasoning controls, so the
    fact-extraction call inherits the model's default behaviour. On reasoning
    models (``deepseek-v4-flash`` here) that means a full reasoning pass per
    memory write, which is pure latency on a structured extraction task.

    Ark does not use OpenAI's ``reasoning_effort``; it honours
    ``thinking: {"type": "disabled"}``, which takes the reasoning-token count
    to zero. mem0 forwards arbitrary ``**kwargs`` into the request body
    (``mem0/llms/base.py`` ``_get_common_params``), so the flag rides along in
    ``extra_body`` and reaches the API intact.

    The ``@observe`` decorator turns every extraction/comparison call into a
    Langfuse generation span, restoring the mem0 call chain that was lost when
    the openlit OTLP bridge was removed.

    Callers that pass their own ``extra_body`` keep it untouched.
    """
    if settings.LONG_TERM_MEMORY_DISABLE_THINKING:
        kwargs.setdefault("extra_body", {"thinking": {"type": "disabled"}})

    return _ORIGINAL_LLM_GENERATE_RESPONSE(self, messages=messages, **kwargs)


# Ark rejects OpenAI's ``reasoning_effort``; ``thinking`` is the working knob.
# Applied to the class so every AsyncMemory-built LLM instance inherits it.
OpenAILLM.generate_response = _generate_response_without_thinking



class MemoryService:
    """Service for managing long-term memory using mem0 and pgvector."""

    def __init__(self):
        """Initialize the memory service."""
        self._memory: AsyncMemory | None = None

    @observe(as_type="span")
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
            results = await memory.search(user_id=str(user_id), query=query, limit=20)
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
