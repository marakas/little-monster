import asyncio
import base64
import os
from typing import List

from agents import Agent, Runner, function_tool
from pydantic import BaseModel

# ====== Step 1: Define Schema ======
class Component(BaseModel):
    id: str
    name: str
    type: str  # e.g. service, database, queue

class Connection(BaseModel):
    from_id: str
    to_id: str
    type: str  # e.g. HTTP, message, DB

class ArchitectureDiagram(BaseModel):
    components: List[Component]
    connections: List[Connection]


# ====== Step 2: Tool for Vision-Based Extraction ======
@function_tool
def parse_architecture_diagram(description: str) -> ArchitectureDiagram:
    """Extract system components and their connections from a system diagram description."""
    print("[debug] parse_architecture_diagram called")
    # This function will be filled by the agent's reasoning using the image content
    # In actual production, you might replace this with a Vision+CV parser
    return ArchitectureDiagram(
        components=[],
        connections=[]
    )


# ====== Step 3: Base64 Image Handling ======
def image_to_base64(image_path):
    with open(image_path, "rb") as image_file:
        encoded_string = base64.b64encode(image_file.read()).decode("utf-8")
    return encoded_string


# ====== Step 4: Define Agent ======
agent = Agent(
    name="DiagramParsingAgent",
    instructions=(
        "You are a system architecture parser. "
        "When given a diagram image, extract all components and their relationships. "
        "Call the `parse_architecture_diagram` function using a structured JSON format."
    ),
    tools=[parse_architecture_diagram],
)

# ====== Step 5: Runner Script ======
FILEPATH = "media/diagram1.png"  # Replace with your actual image path


# === Define assessment agents ===
assessment_agents = [
    Agent(
        name="InteractionQualityAgent",
        instructions="""
        You are an expert interviewer for system design interviews. 
        Your job is to analyze the interviewee’s behavior in the transcript.

        Look for:
        - Whether they **ask clarifying questions** about functional and non-functional requirements.
        - Whether they **verify assumptions** and **communicate tradeoffs**.
        - If they **explain their design choices clearly** or remain vague/silent.
        - How structured and confident their **verbal reasoning** appears.
        - Whether they are collaborative or passive in the discussion.

        Give a brief summary of strengths, areas for improvement, and an overall interaction quality rating (1-10).
        """
    ),
    Agent(
        name="StructuredApproachAgent",
        instructions="""
        You are assessing whether the interviewee follows a structured approach to system design.

        Look for the following stages in their reasoning:
        1. Clarifying **high-level requirements**
        2. Identifying **non-functional requirements** (e.g. scalability, availability)
        3. Outlining a **high-level architecture** (components, interactions)
        4. **Drilling down** into key components or flows
        5. Discussing **trade-offs** between options

        Evaluate whether the approach is logical, complete, and well-sequenced. Note any missing or weak steps and give a brief summary.
        """
    ),
    Agent(
        name="OverEngineeringAgent",
        instructions="""
        You are assessing whether the proposed architecture is overly complex for the problem at hand.

        Look for signs of over-engineering:
        - Use of advanced tools, patterns, or infra that don’t align with stated requirements
        - Premature optimization
        - Too many components, layers, or abstractions
        - Heavy reliance on non-essential services or technologies

        Provide a short summary of any over-engineering, unnecessary complexity, or risks of maintainability. Offer a simpler alternative if applicable.
        """
    ),
    Agent(
        name="RequirementCoverageAgent",
        instructions="You are an expert in validating system design against given requirements. Read the document and list each requirement along with whether it's fully, partially, or not addressed. Justify briefly."
    ),
    Agent(
        name="LogicalFlowAgent",
        instructions="You analyze logical flow in system designs. Review the content and highlight any logical inconsistencies, gaps, or contradictory elements in the architecture."
    ),
    Agent(
        name="BottleneckAgent",
        instructions="You're an expert in system scalability and performance. Identify any potential bottlenecks or scaling issues in the described architecture and suggest improvements."
    ),
    Agent(
        name="OptimalityAgent",
        instructions="You evaluate architecture designs for best practices. Rate the design on simplicity, modularity, and future-proofing. Suggest how it could be made more optimal."
    ),
    Agent(
        name="PatternRecognitionAgent",
        instructions="You identify software architecture patterns. List any patterns used in this system (e.g., CQRS, pub/sub) and explain where they appear in the design."
    ),
]

synthesis_agent = Agent(
    name="FinalSynthesisAgent",
    instructions="""
    You are a senior reviewer synthesizing feedback from a panel of expert agents.

    Your task:
    1. **Prioritize key issues** raised across agents (e.g. missing requirements, major bottlenecks, unclear reasoning).
    2. Group similar or redundant feedback.
    3. Highlight:
      - Critical flaws (must fix)
      - Important but not blocking issues
      - Strengths worth keeping
    4. Write a short, clear summary (max 300 words) suitable for the interviewee.
    5. Use bullets and plain language. Be specific but brief.
    """
)


# === Run all assessment agents in parallel ===
async def run_assessments(document: str):
    tasks = [Runner.run(agent, input=document) for agent in assessment_agents]
    results = await asyncio.gather(*tasks)

    print("\n🎯 Agent Results:\n")
    for agent, result in zip(assessment_agents, results):
        print(f"🔹 {agent.name}:\n{result.final_output}\n")

    # Run synthesis agent
    combined_outputs = "\n\n".join(
        f"{agent.name}:\n{result.final_output}" for agent, result in zip(assessment_agents, results)
    )
    synthesis_result = await Runner.run(synthesis_agent, input=combined_outputs)

    print("\n🧠 Final Summary for User:\n")
    print(synthesis_result.final_output)



async def main():
    b64_image = image_to_base64(FILEPATH)

    result = await Runner.run(
        agent,
        [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_image",
                        "detail": "auto",
                        "image_url": f"data:image/png;base64,{b64_image}",
                    }
                ],
            },
            {
                "role": "user",
                "content": "Please analyze this system architecture diagram and extract the components and their connections.",
            },
        ],
    )

    print("\n✅ Final Output:\n")
    print(result.final_output)


    # ====== Step 6: Load Transcript File ======
    TRANSCRIPT_PATH = "media/transcript.txt"  # <-- Set your path

    def load_transcript(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            return f.read()

    transcript = load_transcript(TRANSCRIPT_PATH)

    REQUIREMENTS_PATH = "media/requirements.txt"

    def load_requirements(filepath):
      with open(filepath, "r", encoding="utf-8") as f:
          return f.read()
      
    requirements = load_requirements(REQUIREMENTS_PATH)
   


    # ====== Step 7: Merge Both Sources ======
    merged_document = f"""
    # ❗ Real Evaluation Requirements (not shared with the interviewee)

    {requirements.strip()}

    # 📸 System Architecture Summary (from diagram)
    {result.final_output.strip()}

    # 🗣️ System Design Interview Transcript
    {transcript.strip()}
    """

    # ====== Step 8: Save to File or Pass to Next Agent ======
    # os.makedirs("output", exist_ok=True)
    # with open("output/combined_design_doc.txt", "w", encoding="utf-8") as f:
    #     f.write(merged_document)

    # print("\n📄 Merged design document saved to: output/combined_design_doc.txt")

    # Run assessments
    await run_assessments(merged_document)

if __name__ == "__main__":
    asyncio.run(main())