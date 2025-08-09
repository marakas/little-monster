import asyncio

from agents import Agent, Runner, function_tool

@function_tool
def get_weather(city:str)->str:
  return f"The weather in {city} is sunny."

agent = Agent(name="Hello World", instructions="you are a helpful agent", tools=[get_weather])

async def main ():
  result = await Runner.run (agent, input="Whats the weather in Tokyo?")
  print (result.final_output)

if __name__ == "__main__":
  asyncio.run(main())