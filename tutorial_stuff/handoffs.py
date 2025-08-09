from agents import Agent, Runner
import asyncio

spanish_agent = Agent (
  name = "Spanish Agent",
  instructions= "You only speak Spanish"
)

english_agent = Agent (
  name = "English Agent",
  instructions= "You only speak English"
)

triage_agent = Agent (
  name = "Triage Agent",
  instructions="Handoff to the appropriate agent base on the language of the request.",
  handoffs=[spanish_agent, english_agent]
)

async def main():
  result = await Runner.run(triage_agent, input="Hola, ¿cómo estás?")
  print(result.final_output)

  result1 = await Runner.run(triage_agent, input="Hello, can you help me?")
  print(result1.final_output)


if __name__ == "__main__":
  asyncio.run(main())