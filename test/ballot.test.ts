import { ethers } from "hardhat";
import { mimcSpongecontract } from 'circomlibjs'
import { Ballot } from "../typechain-types";
import { generateCommitment, calculateMerkleRootAndZKProof } from '../src/zktree';
import { BigNumber } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";


const SEED = "mimcsponge";
const TREE_LEVELS = 20;
const TIMEOUT = 10 * 60;


// TODO: add matchers and etc
describe("Ballot test", () => {

	let ballot: Ballot
	let signers: {
		admin: SignerWithAddress,
		validator: SignerWithAddress,
		alice: SignerWithAddress,
		bob: SignerWithAddress,
		thomas: SignerWithAddress,
		candidate1: SignerWithAddress,
		candidate2: SignerWithAddress,
	};

	before(async () => {
		const signersArr = await ethers.getSigners()
		signers = {
			admin: signersArr[0],
			validator: signersArr[1],
			alice: signersArr[2],
			bob: signersArr[3],
			thomas: signersArr[4],
			candidate1: signersArr[5],
			candidate2: signersArr[6],
		}

		const MiMCSponge = new ethers.ContractFactory(mimcSpongecontract.abi, mimcSpongecontract.createCode(SEED, 220), signers[0])
		const mimcsponge = await MiMCSponge.connect(signers.admin).deploy()
		const Verifier = await ethers.getContractFactory("Verifier");
		const verifier = await Verifier.connect(signers.admin).deploy();
		const Ballot = await ethers.getContractFactory("Ballot");

		ballot = await (await Ballot.connect(signers.admin).deploy(
			TREE_LEVELS,
			mimcsponge.address,
			verifier.address,
			[
				signers.alice.address,
				signers.bob.address,
				signers.thomas.address,
			]
		)).deployed();
	});

	it("Test the full process", async () => {
		await expect(ballot.connect(signers.admin).initBallot(
			[signers.candidate1.address, signers.candidate2.address],
			TIMEOUT
		))
			.emit(ballot, 'VouchInitialized')
			.withArgs(
				[signers.candidate1.address, signers.candidate2.address],
				TIMEOUT
			);

		const aliceCommitment = await generateCommitment(BigNumber.from(1))
		const bobCommitment = await generateCommitment(BigNumber.from(1))
		const thomasCommitment = await generateCommitment(BigNumber.from(0))

		await ballot.connect(signers.alice).registerVouchCommitment(aliceCommitment.commitment);
		await ballot.connect(signers.bob).registerVouchCommitment(bobCommitment.commitment);
		await ballot.connect(signers.thomas).registerVouchCommitment(thomasCommitment.commitment);

		const aliceProof = await calculateMerkleRootAndZKProof(
			ballot.address,
			signers.alice,
			TREE_LEVELS,
			aliceCommitment,
			"build/Verifier.zkey"
		);

		const bobProof = await calculateMerkleRootAndZKProof(
			ballot.address,
			signers.bob,
			TREE_LEVELS,
			bobCommitment,
			"build/Verifier.zkey"
		);

		const thomasProof = await calculateMerkleRootAndZKProof(
			ballot.address,
			signers.thomas,
			TREE_LEVELS,
			thomasCommitment,
			"build/Verifier.zkey"
		);

		await time.increase(TIMEOUT * 2);

		await ballot
			.connect(signers.admin)
			.revealVouches(
				BigNumber.from(1),
				aliceCommitment.nullifierHash,
				aliceProof.root,
				aliceProof.proof_a,
				aliceProof.proof_b,
				aliceProof.proof_c
			);

		await ballot
			.connect(signers.admin)
			.revealVouches(
				BigNumber.from(1),
				bobCommitment.nullifierHash,
				bobProof.root,
				bobProof.proof_a,
				bobProof.proof_b,
				bobProof.proof_c
			);

		await ballot
			.connect(signers.admin)
			.revealVouches(
				BigNumber.from(0),
				thomasCommitment.nullifierHash,
				thomasProof.root,
				thomasProof.proof_a,
				thomasProof.proof_b,
				thomasProof.proof_c
			);

		expect(await ballot.stage()).to.equal(1);

		await ballot.connect(signers.admin).finalizeStage();
		await expect(ballot.connect(signers.admin).finalizeBallot())
			.emit(ballot, 'VouchFinished')
			.withArgs(signers.candidate2.address);

		expect(await ballot.vouchers(signers.candidate2.address)).to.equal(true);
		expect(await ballot.stage()).to.equal(0);
	});

});
