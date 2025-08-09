from agents import Agent, Runner, set_tracing_disabled
import asyncio
set_tracing_disabled(disabled=True)

spanish_agent = Agent(
    name="Spanish agent",
    instructions="You only speak Spanish.",
    model="litellm/ollama/llama3.2",
)

english_agent = Agent(
    name="English agent",
    instructions="You only speak English",
    model="litellm/ollama/llama3.2",
 
)

triage_agent = Agent(
    name="Triage agent",
    instructions="Handoff to the appropriate agent based on the language of the request.",
    handoffs=[spanish_agent, english_agent],
    model="litellm/ollama/llama3.2",
 
)


async def main():
    result = await Runner.run(triage_agent, input="Hola, ¿cómo estás?")
    print(result.final_output)
    # ¡Hola! Estoy bien, gracias por preguntar. ¿Y tú, cómo estás?
    result1 = await Runner.run(triage_agent, input="Hello, can you help me?")
    print(result1.final_output)

if __name__ == "__main__":
    asyncio.run(main())